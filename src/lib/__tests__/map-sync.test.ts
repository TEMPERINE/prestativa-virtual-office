import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { MapSyncController, normalizeMapOverrides, type CanonicalMapRow } from "@/lib/map-sync";

const small = (zone: string) => ({
  cols: 2,
  rows: 2,
  blocked: [1, 0, 0, 0],
  zones: [zone, null, null, null],
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

describe("normalizeMapOverrides", () => {
  it("resample para 128x80 e preenche defaults", () => {
    const n = normalizeMapOverrides(small("reuniao"))!;
    expect(n.cols).toBe(128);
    expect(n.rows).toBe(80);
    expect(n.blocked.length).toBe(128 * 80);
    expect(n.zones[0]).toBe("reuniao");
    expect(n.zones[127]).toBeNull();
    expect(n.customZones).toEqual([]);
  });
  it("rejeita entrada inválida", () => {
    expect(normalizeMapOverrides(null)).toBeNull();
    expect(normalizeMapOverrides({ cols: 2 })).toBeNull();
  });
  it("é idempotente", () => {
    const a = normalizeMapOverrides(small("x"))!;
    expect(normalizeMapOverrides(a)).toEqual(a);
  });
});

describe("MapSyncController", () => {
  it("1. carregamento inicial normaliza e fica READY", async () => {
    const c = new MapSyncController({
      fetchCanonical: async () => ({ data: small("a"), version: 3 }),
    });
    expect(c.snapshot().state).toBe("LOADING");
    await c.load();
    const s = c.snapshot();
    expect(s.state).toBe("READY");
    expect(s.version).toBe(3);
    expect(s.map!.cols).toBe(128);
  });

  it("2. atualização Realtime passa pelo normalizador (refetch canônico)", async () => {
    const fetch = vi
      .fn<() => Promise<CanonicalMapRow>>()
      .mockResolvedValueOnce({ data: small("a"), version: 1 })
      .mockResolvedValueOnce({ data: small("b"), version: 2 });
    const c = new MapSyncController({ fetchCanonical: fetch });
    await c.load();
    await c.notify(2);
    expect(c.snapshot().map!.cols).toBe(128);
    expect(c.snapshot().map!.zones[0]).toBe("b");
  });

  it("3. cache restaurado passa pelo normalizador e não marca READY", () => {
    const c = new MapSyncController({ fetchCanonical: async () => null });
    c.restoreCache(small("c"), 5);
    expect(c.snapshot().map!.cols).toBe(128);
    expect(c.snapshot().state).toBe("LOADING");
    c.restoreCache({ garbage: true }, 9);
    expect(c.snapshot().version).toBe(5);
  });

  it("4. version maior inicia SYNCING e volta para READY", async () => {
    const d = deferred<CanonicalMapRow>();
    const fetch = vi
      .fn<() => Promise<CanonicalMapRow>>()
      .mockResolvedValueOnce({ data: small("a"), version: 1 })
      .mockReturnValueOnce(d.promise);
    const c = new MapSyncController({ fetchCanonical: fetch });
    await c.load();
    const p = c.notify(2);
    expect(c.snapshot().state).toBe("SYNCING");
    d.resolve({ data: small("b"), version: 2 });
    await p;
    expect(c.snapshot()).toMatchObject({ state: "READY", version: 2 });
  });

  it("5/6. version igual ou menor é ignorada", async () => {
    const fetch = vi.fn(async () => ({ data: small("a"), version: 4 }));
    const c = new MapSyncController({ fetchCanonical: fetch });
    await c.load();
    expect(c.notify(4)).toBeUndefined();
    expect(c.notify(2)).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(c.snapshot()).toMatchObject({ state: "READY", version: 4 });
  });

  it("7. resposta atrasada de versão antiga não sobrescreve a nova", async () => {
    const d12 = deferred<CanonicalMapRow>();
    const fetch = vi
      .fn<() => Promise<CanonicalMapRow>>()
      .mockResolvedValueOnce({ data: small("v11"), version: 11 })
      .mockReturnValueOnce(d12.promise)
      .mockResolvedValueOnce({ data: small("v13"), version: 13 });
    const c = new MapSyncController({ fetchCanonical: fetch });
    await c.load();
    const p = c.notify(12);
    c.notify(13);
    d12.resolve({ data: small("v12"), version: 12 });
    await p;
    expect(c.snapshot()).toMatchObject({ state: "READY", version: 13 });
    expect(c.snapshot().map!.zones[0]).toBe("v13");
    // Resposta atrasada que chega depois: descartada.
    c.applyConfirmed(small("v12"), 12);
    expect(c.snapshot().version).toBe(13);
  });

  it("8. duas atualizações rápidas convergem para a maior", async () => {
    let v = 1;
    const c = new MapSyncController({
      fetchCanonical: async () => ({ data: small(`v${v}`), version: v }),
    });
    await c.load();
    v = 3;
    const a = c.notify(2);
    const b = c.notify(3);
    await Promise.all([a, b]);
    expect(c.snapshot()).toMatchObject({ state: "READY", version: 3 });
  });

  it("banco atrasado (versão menor que a anunciada) refaz fetch e depois ERROR explícito", async () => {
    const c = new MapSyncController({
      fetchCanonical: async () => ({ data: small("a"), version: 1 }),
      maxStaleRefetch: 2,
    });
    await c.load();
    await c.notify(5);
    expect(c.snapshot().state).toBe("ERROR");
    expect(c.snapshot().version).toBe(1);
  });

  it("9/10. erro no fetch => ERROR; retry bem-sucedido => READY", async () => {
    const fetch = vi
      .fn<() => Promise<CanonicalMapRow>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: small("a"), version: 7 });
    const c = new MapSyncController({ fetchCanonical: fetch });
    await c.load();
    expect(c.snapshot()).toMatchObject({ state: "ERROR", error: "offline" });
    await c.retry();
    expect(c.snapshot()).toMatchObject({ state: "READY", version: 7, error: null });
  });

  it("edição local e save confirmado passam pelo normalizador; version nunca diminui", () => {
    const c = new MapSyncController({ fetchCanonical: async () => null });
    c.applyLocalEdit(small("e"));
    expect(c.snapshot().map!.cols).toBe(128);
    c.applyConfirmed(small("s"), 4);
    expect(c.snapshot()).toMatchObject({ state: "READY", version: 4 });
    c.applyConfirmed(small("old"), 3);
    expect(c.snapshot().map!.zones[0]).toBe("s");
  });
});

describe("11. nenhum caminho grava override bruto no cache canônico", () => {
  let src = "";
  beforeEach(() => {
    src = readFileSync("src/lib/map-overrides.ts", "utf8");
  });
  it("sem variável de cache mutável nem escrita direta de payload", () => {
    expect(src).not.toMatch(/\bcache\s*=/);
    expect(src).not.toMatch(/resampleOverrides/);
    expect(src).not.toMatch(/payload\.new[^\n]*\.data/);
    // única escrita no localStorage é o persist() do controller
    expect(src.match(/localStorage\.setItem/g)?.length).toBe(1);
  });
});

describe("integração map-overrides", () => {
  beforeEach(async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
      dispatchEvent: () => true,
    });
    vi.stubGlobal(
      "CustomEvent",
      class {
        constructor(public type: string) {}
      },
    );
    const mo = await import("@/lib/map-overrides");
    mo.__resetMapSyncForTests();
  });

  it("cache legado bruto é normalizado ao restaurar e saveOverrides normaliza", async () => {
    const mo = await import("@/lib/map-overrides");
    window.localStorage.setItem(mo.STORAGE_KEY, JSON.stringify(small("legacy")));
    mo.__resetMapSyncForTests();
    const o = mo.loadOverrides()!;
    expect(o.cols).toBe(128);
    expect(mo.getMapSync().snapshot().version).toBe(0);
    mo.saveOverrides(small("edit") as never);
    expect(mo.loadOverrides()!.blocked.length).toBe(128 * 80);
    expect(mo.zoneFromOverrides({ x: 0, y: 0 })).toBe("edit");
  });
});

it("canonical fetch replaces an unconfirmed same-version cache before READY",async()=>{
 const c=new MapSyncController({fetchCanonical:async()=>({data:small("confirmed"),version:5})});
 c.restoreCache(small("local-draft"),5);await c.load();
 expect(c.snapshot().state).toBe("READY");expect(c.snapshot().map?.zones[0]).toBe("confirmed");
});
it("an invalid canonical document cannot mark an unconfirmed cache READY",async()=>{
 const c=new MapSyncController({fetchCanonical:async()=>({data:{bad:true},version:5})});
 c.restoreCache(small("cache"),5);await c.load();expect(c.snapshot().state).toBe("ERROR");
});
it("a canonical read older than restored cache must retry, never authorize recovery",async()=>{
 const fetch=vi.fn(async()=>({data:small("old"),version:4}));
 const c=new MapSyncController({fetchCanonical:fetch,maxStaleRefetch:1});c.restoreCache(small("cache"),5);
 await c.load();expect(c.snapshot().state).toBe("ERROR");expect(c.snapshot().version).toBe(5);expect(fetch.mock.calls.length).toBeGreaterThan(1);
});

it.each([{}, [null], [{kind:"workspace"}]])("malformed custom metadata fails closed without throwing or replacing the last map: %j", async (customZones) => {
 const fetch = vi.fn<() => Promise<CanonicalMapRow>>()
   .mockResolvedValueOnce({data:small("known"),version:1})
   .mockResolvedValueOnce({data:{...small("broken"),customZones},version:2});
 const c = new MapSyncController({fetchCanonical:fetch}); await c.load(); const previous=c.snapshot().map;
 await expect(c.notify(2)).resolves.toBeUndefined();
 expect(c.snapshot()).toMatchObject({state:"ERROR",version:1}); expect(c.snapshot().map).toBe(previous);
 expect(normalizeMapOverrides({...small("bad-cache"),customZones})).toBeNull();
 expect(()=>c.restoreCache({...small("bad-cache"),customZones},3)).not.toThrow();
 expect(c.snapshot().map).toBe(previous);
});
