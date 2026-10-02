import { test } from "node:test";
import assert from "node:assert/strict";
import * as model from "../src/model";
import { buildGraph, assignLevels, computeValues, layoutVertical, compareNodes, assignFallbackColors } from "../src/model";

test("model module loads", () => {
    assert.equal(typeof model, "object");
});

test("compareNodes: custom order sorts by list, out-of-list names sort after by index", () => {
    const mk = (name: string, index: number): any => ({ name, index });
    const order = ["Z", "Y"];
    assert.ok(compareNodes(mk("Z", 5), mk("Y", 1), order) < 0, "Z before Y by order list");
    assert.ok(compareNodes(mk("Y", 1), mk("Q", 0), order) < 0, "listed Y before unlisted Q");
    assert.ok(compareNodes(mk("Q", 3), mk("R", 2), order) > 0, "unlisted sort by index");
    assert.ok(compareNodes(mk("Q", 3), mk("R", 2)) > 0, "no order => pure index");
});

test("assignFallbackColors: distinct node names get distinct colors within palette size (no hash collision)", () => {
    // These three names hash-collide under the old deterministicColor (all index 4).
    const palette = ["#c0", "#c1", "#c2", "#c3", "#c4"];
    const names = ["Carteira de Pedidos", "Em Revisão Comercial", "Programado", "Meta", "Sem Remessa"];
    const map = assignFallbackColors(names, palette);
    assert.notEqual(map.get("Carteira de Pedidos"), map.get("Em Revisão Comercial"), "parent and child must differ");
    assert.notEqual(map.get("Carteira de Pedidos"), map.get("Programado"));
    const used = names.map(n => map.get(n));
    assert.equal(new Set(used).size, names.length, "all names distinct within palette size");
    // assignment is by index (stable, deterministic)
    assert.equal(map.get("Carteira de Pedidos"), "#c0");
    assert.equal(map.get("Em Revisão Comercial"), "#c1");
});

test("assignFallbackColors: wraps by index when names exceed palette", () => {
    const palette = ["#c0", "#c1"];
    const map = assignFallbackColors(["a", "b", "c"], palette);
    assert.equal(map.get("a"), "#c0");
    assert.equal(map.get("b"), "#c1");
    assert.equal(map.get("c"), "#c0");
});

test("buildGraph derives nodes from the union of source and target", () => {
    const g = buildGraph([
        { source: "A", target: "B", value: 10 },
        { source: "B", target: "C", value: 4 },
        { source: "B", target: "D", value: 6, description: "dee" },
    ]);
    assert.deepEqual(g.nodes.map(n => n.name), ["A", "B", "C", "D"]);
    assert.equal(g.links.length, 3);
    const b = g.nodes.find(n => n.name === "B")!;
    assert.equal(b.incoming.length, 1);
    assert.equal(b.outgoing.length, 2);
    assert.equal(g.nodes.find(n => n.name === "D")!.description, "dee");
});

test("buildGraph drops zero and negative value edges", () => {
    const g = buildGraph([
        { source: "A", target: "B", value: 0 },
        { source: "A", target: "C", value: 5 },
    ]);
    assert.deepEqual(g.links.map(l => l.target), ["C"]);
});

test("buildGraph drops nodes left with no positive flow (zero-value nodes vanish)", () => {
    const g = buildGraph([
        { source: "A", target: "B", value: 0 },   // B reachable only via a 0 edge
        { source: "A", target: "C", value: 5 },
    ]);
    assert.deepEqual(g.nodes.map(n => n.name), ["A", "C"], "B has no positive flow -> dropped");
});

test("buildGraph re-indexes surviving nodes contiguously after pruning", () => {
    const g = buildGraph([
        { source: "A", target: "Zero", value: 0 },
        { source: "A", target: "B", value: 3 },
        { source: "B", target: "C", value: 2 },
    ]);
    assert.deepEqual(g.nodes.map(n => n.name), ["A", "B", "C"]);
    assert.deepEqual(g.nodes.map(n => n.index), [0, 1, 2]);
});

test("assignLevels uses explicit levels when provided", () => {
    const g = buildGraph([{ source: "A", target: "B", value: 5 }, { source: "B", target: "C", value: 5 }]);
    assignLevels(g, new Map([["B", 1], ["C", 2]]));
    assert.deepEqual(g.nodes.map(n => [n.name, n.level]), [["A", 0], ["B", 1], ["C", 2]]);
});

test("assignLevels auto-derives longest path when no explicit levels", () => {
    // A->B->C and A->C ; C must sit past its deepest ancestor (level 2), not level 1
    const g = buildGraph([
        { source: "A", target: "B", value: 5 },
        { source: "B", target: "C", value: 5 },
        { source: "A", target: "C", value: 3 },
    ]);
    assignLevels(g, new Map());
    const lvl = (name: string) => g.nodes.find(n => n.name === name)!.level;
    assert.equal(lvl("A"), 0);
    assert.equal(lvl("B"), 1);
    assert.equal(lvl("C"), 2);
});

test("assignLevels does not loop on a cycle", () => {
    const g = buildGraph([{ source: "A", target: "B", value: 1 }, { source: "B", target: "A", value: 1 }]);
    assignLevels(g, new Map());
    assert.ok(Number.isFinite(g.nodes[0].level));
});

test("computeValues takes the max of incoming and outgoing", () => {
    const g = buildGraph([
        { source: "A", target: "B", value: 10 },
        { source: "B", target: "C", value: 4 },
        { source: "B", target: "D", value: 3 },
    ]);
    computeValues(g);
    assert.equal(g.nodes.find(n => n.name === "B")!.value, 10); // in=10 > out=7
});

test("uses the configured reference flow to preserve source value and size the link to target flow", () => {
    const g = buildGraph([
        { source: "Meta", target: "Carteira de Pedidos", value: 30 },
        { source: "Carteira de Pedidos", target: "Com Remessa", value: 20 },
        { source: "Carteira de Pedidos", target: "Faturado", value: 5 }
    ]);
    assignLevels(g);
    computeValues(g, { source: "Meta", target: "Carteira de Pedidos" });

    assert.equal(g.nodes.find(node => node.name === "Meta")!.value, 30);
    assert.equal(g.nodes.find(node => node.name === "Carteira de Pedidos")!.value, 25);
    assert.equal(g.links.find(link => link.source === "Meta")!.value, 25);
});

test("does not alter flows when no reference-flow configuration is supplied", () => {
    const g = buildGraph([
        { source: "Meta", target: "Carteira de Pedidos", value: 30 },
        { source: "Carteira de Pedidos", target: "Com Remessa", value: 20 }
    ]);
    computeValues(g);

    assert.equal(g.nodes.find(node => node.name === "Meta")!.value, 30);
    assert.equal(g.nodes.find(node => node.name === "Carteira de Pedidos")!.value, 30);
    assert.equal(g.links.find(link => link.source === "Meta")!.value, 30);
});

test("layoutVertical centers nodes relative to incoming parents and keeps y >= 0", () => {
    const g = buildGraph([
        { source: "Root1", target: "NodeA", value: 10 },
        { source: "Root2", target: "NodeB", value: 10 },
        { source: "NodeA", target: "Leaf1", value: 10 },
        { source: "NodeB", target: "Leaf2", value: 10 }
    ]);
    assignLevels(g);
    computeValues(g);
    g.nodes.forEach(n => { n.height = 50; });
    layoutVertical(g, 20);

    // All nodes must be non-negative
    for (const node of g.nodes) {
        assert.ok(node.y >= 0, `Node ${node.name} has y < 0: ${node.y}`);
    }

    // Nodes in same column must not overlap
    for (let lvl = 0; lvl <= 2; lvl++) {
        const colNodes = g.nodes.filter(n => n.level === lvl).sort((a, b) => a.y - b.y);
        for (let i = 0; i < colNodes.length - 1; i++) {
            const currentBottom = colNodes[i].y + colNodes[i].height;
            const nextTop = colNodes[i + 1].y;
            assert.ok(nextTop >= currentBottom - 0.001, `Col ${lvl} nodes overlap: ${colNodes[i].name} and ${colNodes[i+1].name}`);
        }
    }
});

// Mirrors the real "Sankey Arestas" topology/order. After layout, the children
// of "Carteira de Pedidos" must read top->bottom: Em Revisão, Sem Remessa,
// Com Remessa, Faturado (the edge/Id order), not a scrambled barycenter order.
function carteiraGraph() {
    return buildGraph([
        { source: "Meta", target: "Carteira de Pedidos", value: 100 },
        { source: "Carteira de Pedidos", target: "Em Revisão Comercial", value: 10 },
        { source: "Carteira de Pedidos", target: "Sem Remessa", value: 20 },
        { source: "Carteira de Pedidos", target: "Com Remessa", value: 45 },
        { source: "Carteira de Pedidos", target: "Faturado", value: 25 },
        { source: "Sem Remessa", target: "Negativo", value: 5 },
        { source: "Sem Remessa", target: "Estoque Reservado", value: 15 },
        { source: "Com Remessa", target: "Não Programado", value: 30 },
        { source: "Com Remessa", target: "Programado", value: 15 },
    ]);
}

test("layoutVertical orders Carteira children top->bottom by edge order", () => {
    const g = carteiraGraph();
    assignLevels(g);
    computeValues(g, { source: "Meta", target: "Carteira de Pedidos" });
    g.nodes.forEach(n => { n.height = Math.max(2, n.value); });
    layoutVertical(g, 45);

    const level2 = g.nodes.filter(n => n.level === 2).sort((a, b) => a.y - b.y).map(n => n.name);
    assert.deepEqual(level2, ["Em Revisão Comercial", "Sem Remessa", "Com Remessa", "Faturado"]);
});

test("layoutVertical bottom-aligns single-parent children so they never drop below the parent's bottom", () => {
    const g = carteiraGraph();
    assignLevels(g);
    computeValues(g, { source: "Meta", target: "Carteira de Pedidos" });
    g.nodes.forEach(n => { n.height = Math.max(2, n.value); });
    layoutVertical(g, 45, "bottom");

    const carteira = g.nodes.find(n => n.name === "Carteira de Pedidos")!;
    const carteiraBottom = carteira.y + carteira.height;
    const children = g.nodes.filter(n => n.level === 2);
    for (const child of children) {
        const childBottom = child.y + child.height;
        assert.ok(childBottom <= carteiraBottom + 0.001,
            `${child.name} bottom ${childBottom} drops below Carteira bottom ${carteiraBottom}`);
    }
});

test("layoutVertical single-parent: bottom aligns group to parent's bottom", () => {
    const g = carteiraGraph();
    assignLevels(g);
    computeValues(g, { source: "Meta", target: "Carteira de Pedidos" });
    g.nodes.forEach(n => { n.height = Math.max(2, n.value); });
    layoutVertical(g, 45, "bottom");
    const carteira = g.nodes.find(n => n.name === "Carteira de Pedidos")!;
    const bottom = carteira.y + carteira.height;
    const children = g.nodes.filter(n => n.level === 2);
    const groupBottom = Math.max(...children.map(c => c.y + c.height));
    assert.ok(Math.abs(groupBottom - bottom) < 0.001, `group bottom ${groupBottom} != parent bottom ${bottom}`);
    assert.ok(g.nodes.every(n => n.y >= 0));
});

test("layoutVertical single-parent: top aligns group to parent's top", () => {
    const g = carteiraGraph();
    assignLevels(g);
    computeValues(g, { source: "Meta", target: "Carteira de Pedidos" });
    g.nodes.forEach(n => { n.height = Math.max(2, n.value); });
    layoutVertical(g, 45, "top");
    const carteira = g.nodes.find(n => n.name === "Carteira de Pedidos")!;
    const topChild = g.nodes.filter(n => n.level === 2).sort((a, b) => a.y - b.y)[0];
    assert.ok(Math.abs(topChild.y - carteira.y) < 0.001, `top child ${topChild.y} != parent top ${carteira.y}`);
});

test("layoutVertical single-parent: center centers group on parent", () => {
    const g = carteiraGraph();
    assignLevels(g);
    computeValues(g, { source: "Meta", target: "Carteira de Pedidos" });
    g.nodes.forEach(n => { n.height = Math.max(2, n.value); });
    layoutVertical(g, 45, "center");
    const carteira = g.nodes.find(n => n.name === "Carteira de Pedidos")!;
    const children = g.nodes.filter(n => n.level === 2);
    const groupMid = (Math.min(...children.map(c => c.y)) + Math.max(...children.map(c => c.y + c.height))) / 2;
    const parentMid = carteira.y + carteira.height / 2;
    assert.ok(Math.abs(groupMid - parentMid) < 0.001, `group mid ${groupMid} != parent mid ${parentMid}`);
});

test("resolveLinkOpacity calculates resting and hover opacities correctly", () => {
    // Default values
    assert.deepEqual(model.resolveLinkOpacity(undefined), { resting: 0.45, hover: 0.75 });
    assert.deepEqual(model.resolveLinkOpacity(null), { resting: 0.45, hover: 0.75 });
    assert.deepEqual(model.resolveLinkOpacity(NaN), { resting: 0.45, hover: 0.75 });

    // Percentage values (10 to 90)
    assert.deepEqual(model.resolveLinkOpacity(45), { resting: 0.45, hover: 0.75 });
    assert.deepEqual(model.resolveLinkOpacity(20), { resting: 0.20, hover: 0.50 });
    assert.deepEqual(model.resolveLinkOpacity(80), { resting: 0.80, hover: 1.0 });

    // Decimal values (0.1 to 0.9)
    assert.deepEqual(model.resolveLinkOpacity(0.45), { resting: 0.45, hover: 0.75 });
    assert.deepEqual(model.resolveLinkOpacity(0.3), { resting: 0.30, hover: 0.60 });

    // Clamped boundaries
    assert.deepEqual(model.resolveLinkOpacity(5), { resting: 0.10, hover: 0.40 });
    assert.deepEqual(model.resolveLinkOpacity(99), { resting: 0.90, hover: 1.0 });
});

test("resolveLinkCurvature clamps curvature between 0.1 and 0.9 with default 0.5", () => {
    assert.equal(model.resolveLinkCurvature(undefined), 0.5);
    assert.equal(model.resolveLinkCurvature(null), 0.5);
    assert.equal(model.resolveLinkCurvature(NaN), 0.5);

    assert.equal(model.resolveLinkCurvature(0.1), 0.1);
    assert.equal(model.resolveLinkCurvature(0.5), 0.5);
    assert.equal(model.resolveLinkCurvature(0.9), 0.9);

    // Percentage input support
    assert.equal(model.resolveLinkCurvature(30), 0.3);
    assert.equal(model.resolveLinkCurvature(70), 0.7);

    // Clamping boundaries
    assert.equal(model.resolveLinkCurvature(0.02), 0.1);
    assert.equal(model.resolveLinkCurvature(1.5), 0.9);
});

test("resolveLinkFill resolves color according to mode", () => {
    const src = "#002D62";
    const tgt = "#008859";

    // Target mode (default)
    assert.equal(model.resolveLinkFill({ mode: "target", sourceColor: src, targetColor: tgt }), tgt);
    // Source mode
    assert.equal(model.resolveLinkFill({ mode: "source", sourceColor: src, targetColor: tgt }), src);
    // Neutral mode with custom color
    assert.equal(model.resolveLinkFill({ mode: "neutral", sourceColor: src, targetColor: tgt, neutralColor: "#9CA3AF" }), "#9CA3AF");
    // Neutral mode with fallback
    assert.equal(model.resolveLinkFill({ mode: "neutral", sourceColor: src, targetColor: tgt }), "#D1D5DB");
    // Gradient mode with grad ID
    assert.equal(model.resolveLinkFill({ mode: "gradient", sourceColor: src, targetColor: tgt, gradientId: "test-grad-1" }), "url(#test-grad-1)");
    // Gradient mode fallback without grad ID
    assert.equal(model.resolveLinkFill({ mode: "gradient", sourceColor: src, targetColor: tgt }), tgt);
});

test("computeLinkPath produces valid SVG path and adjusts curvature", () => {
    const pathMid = model.computeLinkPath(100, 50, 80, 500, 100, 130, 0.5);
    assert.ok(pathMid.startsWith("M 100,50"));
    assert.ok(pathMid.includes("C 300,50 300,100 500,100"));
    assert.ok(pathMid.endsWith("Z"));

    const pathAngular = model.computeLinkPath(100, 50, 80, 500, 100, 130, 0.1);
    // dx = 400; dx * 0.1 = 40; sx + 40 = 140; tx - 40 = 460
    assert.ok(pathAngular.includes("C 140,50 460,100 500,100"));

    const pathCurvy = model.computeLinkPath(100, 50, 80, 500, 100, 130, 0.9);
    // dx = 400; dx * 0.9 = 360; sx + 360 = 460; tx - 360 = 140
    assert.ok(pathCurvy.includes("C 460,50 140,100 500,100"));
});

test("LinkConfigCardSettings initializes with required defaults and handles onPreProcess", async () => {
    const { LinkConfigCardSettings, VisualFormattingSettingsModel } = await import("../src/settings");
    const card = new LinkConfigCardSettings();

    assert.equal(card.name, "linkConfig");
    assert.equal(card.displayName, "Fluxos / Conexões");
    assert.equal(card.linkOpacity.value, 45);
    assert.equal(card.linkColorMode.value.value, "target");
    assert.equal(card.linkNeutralColor.value.value, "#D1D5DB");
    assert.equal(card.linkCurvature.value, 0.5);

    // Verify onPreProcess visibility toggling for neutral color
    card.onPreProcess();
    assert.equal(card.linkNeutralColor.visible, false);

    card.linkColorMode.value = { value: "neutral", displayName: "Cor Neutra Fixa" };
    card.onPreProcess();
    assert.equal(card.linkNeutralColor.visible, true);

    const modelObj = new VisualFormattingSettingsModel();
    assert.ok(modelObj.linkConfig instanceof LinkConfigCardSettings);
    assert.ok(modelObj.cards.includes(modelObj.linkConfig));
});

test("formatCompactValue formats numbers accurately and applies decimal overrides", () => {
    assert.equal(model.formatCompactValue(NaN), "0");
    assert.equal(model.formatCompactValue(Infinity), "0");

    // Billions default vs override
    assert.equal(model.formatCompactValue(2500000000), "2,50B");
    assert.equal(model.formatCompactValue(2500000000, 1), "2,5B");
    assert.equal(model.formatCompactValue(2500000000, 0), "3B");

    // Millions default vs override
    assert.equal(model.formatCompactValue(1500000), "1,5M");
    assert.equal(model.formatCompactValue(1500000, 2), "1,50M");
    assert.equal(model.formatCompactValue(1500000, 0), "2M");

    // Thousands default vs override
    assert.equal(model.formatCompactValue(4500), "5K");
    assert.equal(model.formatCompactValue(4500, 1), "4,5K");
    assert.equal(model.formatCompactValue(4500, 2), "4,50K");

    // Smaller values
    assert.equal(model.formatCompactValue(250), "250");
    assert.equal(model.formatCompactValue(250, 2), "250,00");
    assert.equal(model.formatCompactValue(250, 0), "250");
});

test("resolveLabelTypography provides robust defaults and sanitizes custom configurations", () => {
    const defaults = model.resolveLabelTypography(null);
    assert.equal(defaults.show, true);
    assert.equal(defaults.fontFamily, "'Segoe UI', sans-serif");
    assert.equal(defaults.fontSize, 13);
    assert.equal(defaults.fontColor, "#2c3e50");
    assert.equal(defaults.bold, true);
    assert.equal(defaults.contentMode, "nameAndValue");
    assert.equal(defaults.position, "left");
    assert.equal(defaults.decimalPlaces, null);

    const custom = model.resolveLabelTypography({
        show: false,
        fontFamily: "Arial",
        fontSize: 16,
        fontColor: "#002D62",
        bold: false,
        labelContentMode: "nameAboveValue",
        labelPosition: "right",
        decimalPlaces: 2
    });
    assert.equal(custom.show, false);
    assert.equal(custom.fontFamily, "Arial");
    assert.equal(custom.fontSize, 16);
    assert.equal(custom.fontColor, "#002D62");
    assert.equal(custom.bold, false);
    assert.equal(custom.contentMode, "nameAboveValue");
    assert.equal(custom.position, "right");
    assert.equal(custom.decimalPlaces, 2);

    // Negative decimal places treated as auto (null)
    const autoDec = model.resolveLabelTypography({ decimalPlaces: -1 });
    assert.equal(autoDec.decimalPlaces, null);
});

test("resolveLabelPosition computes coordinate and textAnchor for left, right, and center", () => {
    const left = model.resolveLabelPosition("left", 100, 20);
    assert.equal(left.x, 92);
    assert.equal(left.textAnchor, "end");

    const right = model.resolveLabelPosition("right", 100, 20);
    assert.equal(right.x, 128);
    assert.equal(right.textAnchor, "start");

    const center = model.resolveLabelPosition("center", 100, 20);
    assert.equal(center.x, 110);
    assert.equal(center.textAnchor, "middle");

    const fallback = model.resolveLabelPosition(undefined, 100, 20);
    assert.equal(fallback.x, 92);
    assert.equal(fallback.textAnchor, "end");
});

test("buildNodeLabelLines formats content modes correctly and handles reference subtext", () => {
    const nameAndValue = model.buildNodeLabelLines({
        name: "Meta",
        formattedValue: "1,2M",
        contentMode: "nameAndValue",
        referenceText: "100% da Meta"
    });
    assert.deepEqual(nameAndValue, [
        { text: "Meta (1,2M)" },
        { text: "100% da Meta", isSubtext: true }
    ]);

    const nameOnly = model.buildNodeLabelLines({
        name: "Meta",
        formattedValue: "1,2M",
        contentMode: "nameOnly"
    });
    assert.deepEqual(nameOnly, [{ text: "Meta" }]);

    const valueOnly = model.buildNodeLabelLines({
        name: "Meta",
        formattedValue: "1,2M",
        contentMode: "valueOnly"
    });
    assert.deepEqual(valueOnly, [{ text: "1,2M" }]);

    const nameAboveValue = model.buildNodeLabelLines({
        name: "Meta",
        formattedValue: "1,2M",
        contentMode: "nameAboveValue",
        referenceText: "85% da Meta"
    });
    assert.deepEqual(nameAboveValue, [
        { text: "Meta" },
        { text: "1,2M" },
        { text: "85% da Meta", isSubtext: true }
    ]);
});

test("NodeLabelsCardSettings initializes with required defaults and handles onPreProcess", async () => {
    const { NodeLabelsCardSettings, VisualFormattingSettingsModel } = await import("../src/settings");
    const card = new NodeLabelsCardSettings();

    assert.equal(card.name, "nodeLabels");
    assert.equal(card.displayName, "Rótulos de Dados");
    assert.equal(card.show.value, true);
    assert.equal(card.topLevelSlice, card.show);
    assert.equal(card.fontFamily.value, "Segoe UI");
    assert.equal(card.fontSize.value, 13);
    assert.equal(card.fontColor.value.value, "#2c3e50");
    assert.equal(card.bold.value, true);
    assert.equal(card.labelContentMode.value.value, "nameAndValue");
    assert.equal(card.labelPosition.value.value, "left");
    assert.equal(card.decimalPlaces.value, -1);
    assert.equal(card.showSubtext.value, true);
    assert.equal(card.subtextLabel.value, "");
    assert.equal(card.subtextFontSize.value, 10);
    assert.equal(card.subtextFontColor.value.value, "#6b7280");

    // Verify onPreProcess when show is false (everything hidden)
    card.show.value = false;
    card.onPreProcess();
    assert.equal(card.fontFamily.visible, false);
    assert.equal(card.fontSize.visible, false);
    assert.equal(card.fontColor.visible, false);
    assert.equal(card.bold.visible, false);
    assert.equal(card.labelContentMode.visible, false);
    assert.equal(card.labelPosition.visible, false);
    assert.equal(card.decimalPlaces.visible, false);
    assert.equal(card.showSubtext.visible, false);
    assert.equal(card.subtextLabel.visible, false);
    assert.equal(card.subtextFontSize.visible, false);
    assert.equal(card.subtextFontColor.visible, false);

    // Verify onPreProcess when show is true but showSubtext is false
    card.show.value = true;
    card.showSubtext.value = false;
    card.onPreProcess();
    assert.equal(card.fontFamily.visible, true);
    assert.equal(card.fontSize.visible, true);
    assert.equal(card.fontColor.visible, true);
    assert.equal(card.bold.visible, true);
    assert.equal(card.labelContentMode.visible, true);
    assert.equal(card.labelPosition.visible, true);
    assert.equal(card.decimalPlaces.visible, true);
    assert.equal(card.showSubtext.visible, true);
    assert.equal(card.subtextLabel.visible, false);
    assert.equal(card.subtextFontSize.visible, false);
    assert.equal(card.subtextFontColor.visible, false);

    // Verify onPreProcess when both show and showSubtext are true
    card.showSubtext.value = true;
    card.onPreProcess();
    assert.equal(card.subtextLabel.visible, true);
    assert.equal(card.subtextFontSize.visible, true);
    assert.equal(card.subtextFontColor.visible, true);

    const modelObj = new VisualFormattingSettingsModel();
    assert.ok(modelObj.nodeLabels instanceof NodeLabelsCardSettings);
    assert.ok(modelObj.cards.includes(modelObj.nodeLabels));
});

test("resolveSubtextLabel interpolates custom wording and tokens", () => {
    // Defaults
    assert.equal(model.resolveSubtextLabel(undefined, "Meta"), "da Meta");
    assert.equal(model.resolveSubtextLabel("", "Meta"), "da Meta");
    assert.equal(model.resolveSubtextLabel(null, "Orçamento"), "de Orçamento");
    assert.equal(model.resolveSubtextLabel("   ", "Orçamento"), "de Orçamento");

    // Custom labels
    assert.equal(model.resolveSubtextLabel("vs Meta", "Meta"), "vs Meta");
    assert.equal(model.resolveSubtextLabel("atingimento", "Meta"), "atingimento");
    assert.equal(model.resolveSubtextLabel("do Total", "Meta"), "do Total");

    // Token interpolation
    assert.equal(model.resolveSubtextLabel("vs {reference}", "Orçamento"), "vs Orçamento");
    assert.equal(model.resolveSubtextLabel("atingimento de [Reference]", "Meta"), "atingimento de Meta");
});

test("resolveNodeCornerRadius clamps values within 0 to 20 range", () => {
    assert.equal(model.resolveNodeCornerRadius(undefined), 3);
    assert.equal(model.resolveNodeCornerRadius(null), 3);
    assert.equal(model.resolveNodeCornerRadius(NaN), 3);
    assert.equal(model.resolveNodeCornerRadius(0), 0);
    assert.equal(model.resolveNodeCornerRadius(5), 5);
    assert.equal(model.resolveNodeCornerRadius(10), 10);
    assert.equal(model.resolveNodeCornerRadius(-2), 0);
    assert.equal(model.resolveNodeCornerRadius(50), 20);
});

test("resolveMinNodeHeight clamps values within 2 to 50 range", () => {
    assert.equal(model.resolveMinNodeHeight(undefined), 4);
    assert.equal(model.resolveMinNodeHeight(null), 4);
    assert.equal(model.resolveMinNodeHeight(NaN), 4);
    assert.equal(model.resolveMinNodeHeight(2), 2);
    assert.equal(model.resolveMinNodeHeight(8), 8);
    assert.equal(model.resolveMinNodeHeight(1), 2);
    assert.equal(model.resolveMinNodeHeight(100), 50);
});

test("resolveLabelTypography includes subtext configuration with clamping and fallbacks", () => {
    const defaults = model.resolveLabelTypography(null);
    assert.equal(defaults.showSubtext, true);
    assert.equal(defaults.subtextLabel, "");
    assert.equal(defaults.subtextFontSize, 10);
    assert.equal(defaults.subtextFontColor, "#6b7280");

    const custom = model.resolveLabelTypography({
        showSubtext: false,
        subtextLabel: "vs Meta",
        subtextFontSize: 14,
        subtextFontColor: "#002D62"
    });
    assert.equal(custom.showSubtext, false);
    assert.equal(custom.subtextLabel, "vs Meta");
    assert.equal(custom.subtextFontSize, 14);
    assert.equal(custom.subtextFontColor, "#002D62");

    // Out of bounds font size clamped
    const clamped = model.resolveLabelTypography({
        subtextFontSize: 2
    });
    assert.equal(clamped.subtextFontSize, 10);
});

test("buildNodeLabelLines honors showSubtext toggle", () => {
    const withSubtext = model.buildNodeLabelLines({
        name: "Meta",
        formattedValue: "1,2M",
        contentMode: "nameAndValue",
        referenceText: "100% da Meta",
        showSubtext: true
    });
    assert.equal(withSubtext.length, 2);
    assert.equal(withSubtext[1].isSubtext, true);

    const withoutSubtext = model.buildNodeLabelLines({
        name: "Meta",
        formattedValue: "1,2M",
        contentMode: "nameAndValue",
        referenceText: "100% da Meta",
        showSubtext: false
    });
    assert.equal(withoutSubtext.length, 1);
    assert.equal(withoutSubtext[0].text, "Meta (1,2M)");
});

test("SankeyConfigCardSettings includes nodeCornerRadius and minNodeHeight", async () => {
    const { SankeyConfigCardSettings } = await import("../src/settings");
    const card = new SankeyConfigCardSettings();

    assert.equal(card.nodeCornerRadius.value, 3);
    assert.equal(card.minNodeHeight.value, 4);
    assert.ok(card.slices.includes(card.nodeCornerRadius));
    assert.ok(card.slices.includes(card.minNodeHeight));
});

test("resolveDimmedOpacity parses fractions and percentages, clamped to 0.05..0.50", () => {
    // Defaults
    assert.equal(model.resolveDimmedOpacity(undefined), 0.12);
    assert.equal(model.resolveDimmedOpacity(null), 0.12);
    assert.equal(model.resolveDimmedOpacity(NaN), 0.12);

    // Percentage inputs (5..50)
    assert.equal(model.resolveDimmedOpacity(12), 0.12);
    assert.equal(model.resolveDimmedOpacity(5), 0.05);
    assert.equal(model.resolveDimmedOpacity(40), 0.40);

    // Fraction inputs (0.05..0.50)
    assert.equal(model.resolveDimmedOpacity(0.12), 0.12);
    assert.equal(model.resolveDimmedOpacity(0.05), 0.05);
    assert.equal(model.resolveDimmedOpacity(0.35), 0.35);

    // Clamping out-of-range values
    assert.equal(model.resolveDimmedOpacity(0), 0.05);
    assert.equal(model.resolveDimmedOpacity(2), 0.05);
    assert.equal(model.resolveDimmedOpacity(90), 0.50);
    assert.equal(model.resolveDimmedOpacity(0.99), 0.50);
});

test("InteractionConfigCardSettings initializes with required defaults and slices", async () => {
    const { InteractionConfigCardSettings, VisualFormattingSettingsModel } = await import("../src/settings");
    const card = new InteractionConfigCardSettings();

    assert.equal(card.name, "interactionConfig");
    assert.equal(card.displayName, "Navegação e Interação");
    assert.equal(card.showZoomControls.value, true);
    assert.equal(card.enableWheelZoom.value, true);
    assert.equal(card.dimmedOpacity.value, 12);

    assert.ok(card.slices.includes(card.showZoomControls));
    assert.ok(card.slices.includes(card.enableWheelZoom));
    assert.ok(card.slices.includes(card.dimmedOpacity));

    const modelObj = new VisualFormattingSettingsModel();
    assert.ok(modelObj.interactionConfig instanceof InteractionConfigCardSettings);
    assert.ok(modelObj.cards.includes(modelObj.interactionConfig));
});

test("resolveVisualBackground handles transparent toggle and custom colors", () => {
    assert.equal(model.resolveVisualBackground(true, "#111827"), "transparent");
    assert.equal(model.resolveVisualBackground(false, "#002D62"), "#002D62");
    assert.equal(model.resolveVisualBackground(false, ""), "#FFFFFF");
    assert.equal(model.resolveVisualBackground(undefined, undefined), "#FFFFFF");
    assert.equal(model.resolveVisualBackground(null, null), "#FFFFFF");
});

test("resolveCanvasPadding clamps values and falls back appropriately", () => {
    assert.equal(model.resolveCanvasPadding(undefined, 170), 170);
    assert.equal(model.resolveCanvasPadding(null, 250), 250);
    assert.equal(model.resolveCanvasPadding(-50, 170), 0);
    assert.equal(model.resolveCanvasPadding(900, 250), 600);
    assert.equal(model.resolveCanvasPadding(120, 170), 120);
});

test("computeViewBox produces accurate viewBox dimensions with margins", () => {
    // Default margins: left 170, right 250, top -40, height +80
    // minY = 10, maxY = 500, maxX = 800
    // minX = -170, minY - 40 = -30, width = 800 + 170 + 250 = 1220, height = (500 - 10) + 80 = 570
    assert.equal(model.computeViewBox(10, 500, 800, undefined, undefined), "-170 -30 1220 570");

    // Custom margins: left 80, right 100
    // minY = 0, maxY = 400, maxX = 600
    // minX = -80, minY - 40 = -40, width = 600 + 80 + 100 = 780, height = 400 + 80 = 480
    assert.equal(model.computeViewBox(0, 400, 600, 80, 100), "-80 -40 780 480");
});

test("CanvasConfigCardSettings initializes with required defaults and handles onPreProcess", async () => {
    const { CanvasConfigCardSettings, VisualFormattingSettingsModel } = await import("../src/settings");
    const card = new CanvasConfigCardSettings();

    assert.equal(card.name, "canvasConfig");
    assert.equal(card.displayName, "Tela e Margens");
    assert.equal(card.transparentBackground.value, false);
    assert.equal(card.backgroundColor.value.value, "#FFFFFF");
    assert.equal(card.paddingLeft.value, 170);
    assert.equal(card.paddingRight.value, 250);

    assert.ok(card.slices.includes(card.transparentBackground));
    assert.ok(card.slices.includes(card.backgroundColor));
    assert.ok(card.slices.includes(card.paddingLeft));
    assert.ok(card.slices.includes(card.paddingRight));

    card.onPreProcess();
    assert.equal(card.backgroundColor.visible, true);

    card.transparentBackground.value = true;
    card.onPreProcess();
    assert.equal(card.backgroundColor.visible, false);

    const modelObj = new VisualFormattingSettingsModel();
    assert.ok(modelObj.canvasConfig instanceof CanvasConfigCardSettings);
    assert.ok(modelObj.cards.includes(modelObj.canvasConfig));
});

test("resolveReferenceNodeName extracts node name from strings or ItemDropdown objects", () => {
    assert.equal(model.resolveReferenceNodeName("Meta"), "Meta");
    assert.equal(model.resolveReferenceNodeName("  Carteira  "), "Carteira");
    assert.equal(model.resolveReferenceNodeName({ value: "Meta", displayName: "Meta" }), "Meta");
    assert.equal(model.resolveReferenceNodeName({ value: "", displayName: "(Nenhum)" }), "");
    assert.equal(model.resolveReferenceNodeName(undefined), "");
    assert.equal(model.resolveReferenceNodeName(null), "");
    assert.equal(model.resolveReferenceNodeName({}), "");
});

test("parseNodeOrderOverrides parses per-node ordering instances", () => {
    const instances = {
        "Meta": { order: 1 },
        "Carteira": { order: 2 },
        "Faturado": { order: 3 },
        "Outro": { order: "invalid" },
        "SemOrdem": {}
    };

    const parsed = model.parseNodeOrderOverrides(instances);
    assert.equal(parsed.get("Meta"), 1);
    assert.equal(parsed.get("Carteira"), 2);
    assert.equal(parsed.get("Faturado"), 3);
    assert.equal(parsed.has("Outro"), false);
    assert.equal(parsed.has("SemOrdem"), false);
});

test("compareNodes prioritizes orderMap over list order and index", () => {
    const a = { name: "B", index: 0, level: 0, value: 10, height: 10, x: 0, y: 0, incoming: [], outgoing: [] };
    const b = { name: "A", index: 1, level: 0, value: 10, height: 10, x: 0, y: 0, incoming: [], outgoing: [] };

    // Default: index order -> a before b
    assert.ok(model.compareNodes(a, b) < 0);

    // With string order list: A before B
    assert.ok(model.compareNodes(a, b, ["A", "B"]) > 0);

    // With orderMap: B has priority 1, A has priority 2 -> B before A (overriding ["A", "B"])
    const orderMap = new Map<string, number>([["B", 1], ["A", 2]]);
    assert.ok(model.compareNodes(a, b, ["A", "B"], orderMap) < 0);

    // Node not in orderMap sorts after node in orderMap
    const orderMapPartial = new Map<string, number>([["A", 1]]);
    assert.ok(model.compareNodes(a, b, undefined, orderMapPartial) > 0); // b before a
});

test("layoutVertical orders nodes according to orderMap", () => {
    const g = model.buildGraph([
        { source: "C", target: "Dest", value: 10 },
        { source: "A", target: "Dest", value: 10 },
        { source: "B", target: "Dest", value: 10 }
    ]);
    model.assignLevels(g);

    // Set orderMap: A=1, B=2, C=3
    const orderMap = new Map<string, number>([["A", 1], ["B", 2], ["C", 3]]);
    model.layoutVertical(g, 10, "center", undefined, orderMap);

    const nodeA = g.nodes.find(n => n.name === "A")!;
    const nodeB = g.nodes.find(n => n.name === "B")!;
    const nodeC = g.nodes.find(n => n.name === "C")!;

    assert.ok(nodeA.y < nodeB.y);
    assert.ok(nodeB.y < nodeC.y);
});

test("NodeOrderCardSettings and SankeyConfig dropdowns initialize correctly", async () => {
    const { NodeOrderCardSettings, SankeyConfigCardSettings, VisualFormattingSettingsModel } = await import("../src/settings");
    const orderCard = new NodeOrderCardSettings();
    assert.equal(orderCard.name, "nodeOrderConfig");
    assert.equal(orderCard.displayName, "Ordem dos Nós");

    const sankeyCard = new SankeyConfigCardSettings();
    assert.equal(sankeyCard.referenceFlowSource.value.value, "");
    assert.equal(sankeyCard.referenceFlowSource.value.displayName, "(Nenhum)");
    assert.equal(sankeyCard.referenceFlowTarget.value.value, "");
    assert.equal(sankeyCard.referenceFlowTarget.value.displayName, "(Nenhum)");

    const modelObj = new VisualFormattingSettingsModel();
    assert.ok(modelObj.nodeOrderConfig instanceof NodeOrderCardSettings);
    assert.ok(modelObj.cards.includes(modelObj.nodeOrderConfig));
});

test("extractNodeNamesFromCategories extracts non-empty node names and ignores (Nenhum)", () => {
    const categories: any = [
        {
            source: { roles: { source: true } },
            values: ["Node A", "Node B", " (Nenhum) ", null, ""]
        },
        {
            source: { roles: { target: true } },
            values: ["Node B", "Node C", undefined]
        }
    ];
    const names = model.extractNodeNamesFromCategories(categories);
    assert.deepEqual(names.sort(), ["Node A", "Node B", "Node C"]);
});

test("resolveReferenceNodeName handles (Nenhum) string and object", () => {
    assert.equal(model.resolveReferenceNodeName("(Nenhum)"), "");
    assert.equal(model.resolveReferenceNodeName({ value: "(Nenhum)", displayName: "(Nenhum)" }), "");
    assert.equal(model.resolveReferenceNodeName({ value: "", displayName: "(Nenhum)" }), "");
    assert.equal(model.resolveReferenceNodeName({ value: "Meta", displayName: "Meta" }), "Meta");
    assert.equal(model.resolveReferenceNodeName("  Carteira  "), "Carteira");
});

test("populateFormattingSettingsModel preserves selected dropdown item when availableNodeItems is populated", async () => {
    const { SankeyConfigCardSettings, VisualFormattingSettingsModel } = await import("../src/settings");
    const { FormattingSettingsService } = await import("powerbi-visuals-utils-formattingmodel");

    SankeyConfigCardSettings.availableNodeItems = [
        { value: "", displayName: "(Nenhum)" },
        { value: "Meta", displayName: "Meta" },
        { value: "Carteira", displayName: "Carteira" }
    ];

    const service = new FormattingSettingsService();
    const dataView: any = {
        metadata: {
            objects: {
                sankeyConfig: {
                    referenceFlowSource: "Meta",
                    referenceFlowTarget: "Carteira"
                }
            }
        }
    };

    const populated = service.populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
    assert.deepEqual(populated.sankeyConfig.referenceFlowSource.value, { value: "Meta", displayName: "Meta" });
    assert.deepEqual(populated.sankeyConfig.referenceFlowTarget.value, { value: "Carteira", displayName: "Carteira" });
});

test("parseSlotAssignments extracts slotIndex -> nodeName and ignores (Nenhum) and empty values", () => {
    const instances: any = {
        slot_0: { node: "Meta" },
        slot_1: { node: { value: "Carteira de Pedidos" } },
        slot_2: { node: "(Nenhum)" },
        slot_3: { node: "" },
        slot_4: { node: "Sem Remessa" }
    };
    const slots = model.parseSlotAssignments(instances);
    assert.equal(slots.size, 3);
    assert.equal(slots.get(0), "Meta");
    assert.equal(slots.get(1), "Carteira de Pedidos");
    assert.equal(slots.get(4), "Sem Remessa");
    assert.equal(slots.has(2), false);
    assert.equal(slots.has(3), false);
});

test("parseNodeOrderOverrides assigns ranks based on slot order and deduplicates", () => {
    const instances: any = {
        slot_2: { node: "Faturado" },
        slot_0: { node: "Meta" },
        slot_1: { node: "Carteira de Pedidos" },
        slot_3: { node: "Meta" } // duplicate selection
    };
    const orderMap = model.parseNodeOrderOverrides(instances);
    assert.equal(orderMap.get("Meta"), 1);
    assert.equal(orderMap.get("Carteira de Pedidos"), 2);
    assert.equal(orderMap.get("Faturado"), 3);
});

test("compareNodes with slot-derived orderMap sorts slotted nodes first by rank and unslotted after", () => {
    const mk = (name: string, index: number): any => ({ name, index });
    const orderMap = new Map([
        ["Z", 1],
        ["A", 2]
    ]);
    const nodeZ = mk("Z", 10);
    const nodeA = mk("A", 20);
    const nodeM = mk("M", 1);
    const nodeN = mk("N", 2);

    assert.ok(model.compareNodes(nodeZ, nodeA, undefined, orderMap) < 0, "Z (rank 1) before A (rank 2)");
    assert.ok(model.compareNodes(nodeA, nodeM, undefined, orderMap) < 0, "A (slotted) before M (unslotted)");
    assert.ok(model.compareNodes(nodeM, nodeN, undefined, orderMap) < 0, "unslotted M before unslotted N by index");
});

