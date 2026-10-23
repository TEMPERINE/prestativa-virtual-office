import { describe, it, expect } from "vitest";
import { planOfficeVideoGrid } from "../office-video-grid";

// 1920×1080, Equipe fechada: largura ≈ 42vw, altura sem barra/controles.
const W = Math.round(1920 * 0.42);
const H = 1080 - 52 - 96;

describe("planOfficeVideoGrid", () => {
  it("1 participante fica grande", () => {
    const g = planOfficeVideoGrid(1, W, H);
    expect(g.cols).toBe(1);
    expect(g.tileWidth).toBeGreaterThanOrEqual(300);
  });
  it("3 participantes em 1 coluna", () => {
    expect(planOfficeVideoGrid(3, W, H).cols).toBe(1);
  });
  it("4 e 6 participantes em 2 colunas", () => {
    expect(planOfficeVideoGrid(4, W, H).cols).toBe(2);
    expect(planOfficeVideoGrid(6, W, H).cols).toBe(2);
  });
  it("12 participantes em 3×4 sem scroll", () => {
    const g = planOfficeVideoGrid(12, W, H);
    expect([g.cols, g.rows]).toEqual([3, 4]);
    expect(g.scroll).toBe(false);
    expect(g.tileWidth).toBeGreaterThanOrEqual(170);
  });
  it("16 participantes usam 4 colunas", () => {
    expect(planOfficeVideoGrid(16, W, H).cols).toBe(4);
  });
  it("mantém 16:9", () => {
    const g = planOfficeVideoGrid(8, W, H);
    expect(Math.abs(g.tileWidth / g.tileHeight - 16 / 9)).toBeLessThan(0.02);
  });
  it("nunca fica abaixo do mínimo; usa scroll se faltar altura", () => {
    const g = planOfficeVideoGrid(16, 400, 300);
    expect(g.tileWidth).toBeGreaterThanOrEqual(160);
    expect(g.scroll).toBe(true);
  });
});
