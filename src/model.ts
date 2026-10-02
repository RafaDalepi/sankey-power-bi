export interface EdgeInput {
    source: string;
    target: string;
    value: number;
    level?: number;
    description?: string;
}

export interface ModelLink {
    source: string;
    target: string;
    value: number;
    sourceHeight?: number;
    targetHeight?: number;
    y0?: number;
    y1?: number;
}

export interface ModelNode {
    name: string;
    index: number;
    level: number;
    value: number;
    height: number;
    x: number;
    y: number;
    description?: string;
    incoming: ModelLink[];
    outgoing: ModelLink[];
}

export interface GraphModel {
    nodes: ModelNode[];
    links: ModelLink[];
}

export interface ReferenceFlowConfig {
    source: string;
    target: string;
}

export function buildGraph(edges: EdgeInput[]): GraphModel {
    const nodes: ModelNode[] = [];
    const byName = new Map<string, ModelNode>();

    const ensure = (name: string): ModelNode => {
        let node = byName.get(name);
        if (!node) {
            node = {
                name,
                index: nodes.length,
                level: 0,
                value: 0,
                height: 0,
                x: 0,
                y: 0,
                incoming: [],
                outgoing: []
            };
            byName.set(name, node);
            nodes.push(node);
        }
        return node;
    };

    edges.forEach(edge => {
        ensure(edge.source);
        ensure(edge.target);
    });

    const links: ModelLink[] = edges
        .filter(edge => edge.value > 0)
        .map(edge => ({ source: edge.source, target: edge.target, value: edge.value }));

    links.forEach(link => {
        byName.get(link.source)!.outgoing.push(link);
        byName.get(link.target)!.incoming.push(link);
    });

    edges.forEach(edge => {
        const target = byName.get(edge.target)!;
        if (!target.description && edge.description) {
            target.description = edge.description;
        }
    });

    // Drop nodes left with no positive flow: their only edges were zero/negative
    // (already filtered out of `links`), so they carry value 0 and would otherwise
    // render as empty bars. A node earns a place only if it has at least one
    // value>0 link. Re-index survivors so `index`-based ordering stays contiguous
    // and input-stable.
    const kept = nodes.filter(node => node.incoming.length > 0 || node.outgoing.length > 0);
    kept.forEach((node, i) => { node.index = i; });

    return { nodes: kept, links };
}

export function compareNodes(
    a: ModelNode,
    b: ModelNode,
    order?: string[],
    orderMap?: Map<string, number>
): number {
    if (orderMap && orderMap.size > 0) {
        const hasA = orderMap.has(a.name);
        const hasB = orderMap.has(b.name);
        if (hasA || hasB) {
            const oa = hasA ? orderMap.get(a.name)! : Number.MAX_SAFE_INTEGER;
            const ob = hasB ? orderMap.get(b.name)! : Number.MAX_SAFE_INTEGER;
            if (oa !== ob) return oa - ob;
        }
    }
    if (order && order.length > 0) {
        const ia = order.indexOf(a.name);
        const ib = order.indexOf(b.name);
        const ra = ia >= 0 ? ia : Number.MAX_SAFE_INTEGER;
        const rb = ib >= 0 ? ib : Number.MAX_SAFE_INTEGER;
        if (ra !== rb) return ra - rb;
    }
    return a.index - b.index;
}

export function assignLevels(graph: GraphModel, explicit?: Map<string, number>): void {
    if (explicit && explicit.size > 0) {
        graph.nodes.forEach(node => {
            node.level = explicit.get(node.name) ?? 0;
        });
        return;
    }

    const byName = new Map(graph.nodes.map(node => [node.name, node]));
    const inProgress = new Set<string>();

    const longest = (name: string): number => {
        const node = byName.get(name)!;
        if (inProgress.has(name)) return node.level; // cycle guard
        if (node.incoming.length === 0) return 0;

        inProgress.add(name);
        const level = Math.max(...node.incoming.map(link => longest(link.source) + 1));
        inProgress.delete(name);
        return level;
    };

    graph.nodes.forEach(node => {
        node.level = longest(node.name);
    });
}

const sumLinks = (links: ModelLink[]): number =>
    links.reduce((total, link) => total + link.value, 0);

export function computeValues(graph: GraphModel, referenceFlow?: ReferenceFlowConfig): void {
    const source = referenceFlow && graph.nodes.find(node => node.name === referenceFlow.source);
    const target = referenceFlow && graph.nodes.find(node => node.name === referenceFlow.target);
    const referenceLink = referenceFlow && graph.links.find(link =>
        link.source === referenceFlow.source && link.target === referenceFlow.target
    );

    if (source && target && referenceLink) {
        const referenceValue = referenceLink.value;
        const targetOutgoingValue = sumLinks(target.outgoing);
        if (targetOutgoingValue > 0) {
            referenceLink.value = targetOutgoingValue;
        }

        graph.nodes.forEach(node => {
            if (node === source) {
                node.value = referenceValue;
            } else if (node === target && targetOutgoingValue > 0) {
                node.value = targetOutgoingValue;
            } else {
                node.value = Math.max(sumLinks(node.incoming), sumLinks(node.outgoing));
            }
        });
        return;
    }

    graph.nodes.forEach(node => {
        const inSum = sumLinks(node.incoming);
        const outSum = sumLinks(node.outgoing);
        node.value = Math.max(inSum, outSum);
    });
}

const groupHeight = (nodes: ModelNode[], padding: number): number =>
    nodes.reduce((total, node) => total + node.height, 0) + Math.max(0, nodes.length - 1) * padding;

export type ColumnAlign = "bottom" | "center" | "top";

export function layoutVertical(
    graph: GraphModel,
    padding: number,
    align: ColumnAlign = "center",
    order?: string[],
    orderMap?: Map<string, number>
): void {
    const maxColumn = Math.max(0, ...graph.nodes.map(n => n.level));

    // Column 0 (roots): stack top-to-bottom starting at y = 0
    const roots = graph.nodes.filter(n => n.level === 0);
    roots.sort((a, b) => compareNodes(a, b, order, orderMap));
    let rootY = 0;
    roots.forEach(node => {
        node.y = rootY;
        rootY += node.height + padding;
    });

    for (let col = 1; col <= maxColumn; col++) {
        const colNodes = graph.nodes.filter(n => n.level === col);
        if (!colNodes.length) continue;

        // When every node in this column descends from a single common parent
        // (e.g. Carteira de Pedidos -> Em Revisão / Sem Remessa / Com Remessa /
        // Faturado), align the whole group to that parent per `align` (bottom /
        // center / top), stacking in input order. This keeps the children tied
        // to the parent's band and preserves the edge order.
        const parentNames = new Set<string>();
        colNodes.forEach(node => node.incoming.forEach(link => parentNames.add(link.source)));
        if (parentNames.size === 1) {
            const parent = graph.nodes.find(node => node.name === [...parentNames][0]);
            if (parent) {
                const ordered = colNodes.slice().sort((a, b) => compareNodes(a, b, order, orderMap));
                const gh = groupHeight(ordered, padding);
                let y = align === "bottom" ? parent.y + parent.height - gh
                    : align === "top" ? parent.y
                    : parent.y + parent.height / 2 - gh / 2;
                ordered.forEach(node => { node.y = y; y += node.height + padding; });
                continue;
            }
        }

        // Calculate weighted center of incoming parents for each node
        const nodeCenters = new Map<ModelNode, number>();
        colNodes.forEach(node => {
            let weighted = 0;
            let weight = 0;
            node.incoming.forEach(link => {
                const parent = graph.nodes.find(n => n.name === link.source);
                if (parent) {
                    weighted += (parent.y + parent.height / 2) * link.value;
                    weight += link.value;
                }
            });
            nodeCenters.set(node, weight > 0 ? weighted / weight : 0);
        });

        // Sort nodes in this column by their incoming barycenter (or input order if equal)
        colNodes.sort((a, b) => {
            const ca = nodeCenters.get(a) ?? 0;
            const cb = nodeCenters.get(b) ?? 0;
            if (Math.abs(ca - cb) > 0.001) return ca - cb;
            return compareNodes(a, b, order, orderMap);
        });

        // Calculate overall column center of gravity
        let totalWeighted = 0;
        let totalWeight = 0;
        colNodes.forEach(node => {
            node.incoming.forEach(link => {
                const parent = graph.nodes.find(n => n.name === link.source);
                if (parent) {
                    totalWeighted += (parent.y + parent.height / 2) * link.value;
                    totalWeight += link.value;
                }
            });
        });

        const targetCenter = totalWeight > 0 ? totalWeighted / totalWeight : 0;
        const totalHeight = groupHeight(colNodes, padding);
        let y = targetCenter - totalHeight / 2;

        colNodes.forEach(node => {
            node.y = y;
            y += node.height + padding;
        });
    }

    // Shift all nodes so minimum y is 0
    const minY = Math.min(...graph.nodes.map(n => n.y));
    if (minY !== 0) {
        graph.nodes.forEach(n => { n.y -= minY; });
    }
}


/**
 * Assigns a fallback color to each node by its position in `names`, cycling the
 * palette. Position-based (not name-hash) so distinct nodes never collide while
 * the node count stays within the palette size — the previous name-hash approach
 * mapped e.g. "Carteira de Pedidos" and "Em Revisão Comercial" to the same slot.
 */
export function assignFallbackColors(names: string[], palette: readonly string[]): Map<string, string> {
    const map = new Map<string, string>();
    if (palette.length === 0) return map;
    let i = 0;
    for (const name of names) {
        if (map.has(name)) continue;
        map.set(name, palette[i % palette.length]);
        i++;
    }
    return map;
}

/**
 * Link flow color mode: target node color, source node color, linear gradient, or neutral fixed color.
 */
export type LinkColorMode = "target" | "source" | "gradient" | "neutral";

export interface LinkColorOptions {
    mode: LinkColorMode;
    sourceColor: string;
    targetColor: string;
    neutralColor?: string;
    gradientId?: string;
}

/**
 * Resolves the SVG fill for a link ribbon based on the configured color mode.
 */
export function resolveLinkFill(options: LinkColorOptions): string {
    switch (options.mode) {
        case "source":
            return options.sourceColor;
        case "gradient":
            return options.gradientId ? `url(#${options.gradientId})` : options.targetColor;
        case "neutral":
            return options.neutralColor || "#D1D5DB";
        case "target":
        default:
            return options.targetColor;
    }
}

/**
 * Resolves link opacity and hover opacity from a percentage (10-90) or decimal (0.1-0.9).
 * Default resting opacity is 0.45, with hover scaled appropriately.
 */
export function resolveLinkOpacity(opacity: number | undefined | null): { resting: number; hover: number } {
    if (opacity === undefined || opacity === null || isNaN(opacity)) {
        return { resting: 0.45, hover: 0.75 };
    }
    let val = opacity;
    if (val > 1) {
        val = val / 100;
    }
    val = Math.max(0.1, Math.min(0.9, val));
    const resting = Number(val.toFixed(2));
    const hover = Math.min(1.0, Number((resting + 0.30).toFixed(2)));
    return { resting, hover };
}

/**
 * Resolves link curvature ratio (clamped between 0.1 and 0.9, default 0.5).
 */
export function resolveLinkCurvature(curvature: number | undefined | null): number {
    if (curvature === undefined || curvature === null || isNaN(curvature)) {
        return 0.5;
    }
    let val = curvature;
    // Values >= 5 are treated as percentage inputs (e.g. 10 to 90)
    if (val >= 5) {
        val = val / 100;
    }
    return Math.max(0.1, Math.min(0.9, Number(val.toFixed(2))));
}

/**
 * Computes the SVG path data string for a cubic Bézier link ribbon with customizable curvature.
 */
export function computeLinkPath(
    sx: number,
    sy0: number,
    sy1: number,
    tx: number,
    ty0: number,
    ty1: number,
    curvature: number = 0.5
): string {
    const clampedCurvature = resolveLinkCurvature(curvature);
    const dx = Math.abs(tx - sx);
    const curve = Math.max(4, dx * clampedCurvature);
    return `M ${sx},${sy0} C ${sx + curve},${sy0} ${tx - curve},${ty0} ${tx},${ty0} L ${tx},${ty1} C ${tx - curve},${ty1} ${sx + curve},${sy1} ${sx},${sy1} Z`;
}

export type LabelContentMode = "nameAndValue" | "nameOnly" | "valueOnly" | "nameAboveValue";
export type LabelPosition = "left" | "right" | "center";

export interface NodeLabelLine {
    text: string;
    isSubtext?: boolean;
}

export interface NodeLabelsConfig {
    show?: boolean;
    fontFamily?: string;
    fontSize?: number;
    fontColor?: string;
    bold?: boolean;
    labelContentMode?: LabelContentMode | string | number;
    labelPosition?: LabelPosition | string | number;
    decimalPlaces?: number | null;
    showSubtext?: boolean;
    subtextLabel?: string;
    subtextFontSize?: number;
    subtextFontColor?: string;
}

export interface ResolvedNodeLabelsTypography {
    show: boolean;
    fontFamily: string;
    fontSize: number;
    fontColor: string;
    bold: boolean;
    contentMode: LabelContentMode;
    position: LabelPosition;
    decimalPlaces: number | null;
    showSubtext: boolean;
    subtextLabel: string;
    subtextFontSize: number;
    subtextFontColor: string;
}

/**
 * Formats a numeric value using compact notation (B, M, K) with optional decimal places override.
 * When decimalPlaces is null/undefined/<0, default precision rules apply (2 for B, 1 for M, 0 for K).
 */
export function formatCompactValue(value: number, decimalPlaces?: number | null): string {
    if (!Number.isFinite(value)) return "0";
    const abs = Math.abs(value);
    const d = (decimalPlaces !== undefined && decimalPlaces !== null && decimalPlaces >= 0)
        ? Math.min(4, Math.max(0, Math.round(decimalPlaces)))
        : null;

    if (abs >= 1e9) {
        const decimals = d !== null ? d : 2;
        return `${(value / 1e9).toFixed(decimals).replace(".", ",")}B`;
    }
    if (abs >= 1e6) {
        const decimals = d !== null ? d : 1;
        return `${(value / 1e6).toFixed(decimals).replace(".", ",")}M`;
    }
    if (abs >= 1e3) {
        const decimals = d !== null ? d : 0;
        return `${(value / 1e3).toFixed(decimals).replace(".", ",")}K`;
    }
    if (d !== null) {
        return value.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
    }
    return Math.round(value).toLocaleString("pt-BR");
}

/**
 * Resolves node label typography options with robust fallbacks and clamping.
 */
export function resolveLabelTypography(config?: NodeLabelsConfig | null): ResolvedNodeLabelsTypography {
    const show = config?.show !== false;
    const fontFamily = (config?.fontFamily && config.fontFamily.trim().length > 0)
        ? config.fontFamily
        : "'Segoe UI', sans-serif";
    const rawFontSize = Number(config?.fontSize);
    const fontSize = Number.isFinite(rawFontSize) && rawFontSize >= 6 && rawFontSize <= 48
        ? Math.round(rawFontSize)
        : 13;
    const fontColor = (config?.fontColor && config.fontColor.trim().length > 0)
        ? config.fontColor
        : "#2c3e50";
    const bold = config?.bold !== false;
    const contentModeStr = String(config?.labelContentMode ?? "");
    const contentMode: LabelContentMode = (contentModeStr === "nameOnly"
        || contentModeStr === "valueOnly"
        || contentModeStr === "nameAboveValue")
        ? (contentModeStr as LabelContentMode)
        : "nameAndValue";
    const positionStr = String(config?.labelPosition ?? "");
    const position: LabelPosition = (positionStr === "right" || positionStr === "center")
        ? (positionStr as LabelPosition)
        : "left";
    const rawDecimals = config?.decimalPlaces;
    const decimalPlaces = (rawDecimals !== undefined && rawDecimals !== null && Number.isFinite(Number(rawDecimals)) && Number(rawDecimals) >= 0)
        ? Math.min(4, Math.max(0, Math.round(Number(rawDecimals))))
        : null;

    const showSubtext = config?.showSubtext !== false;
    const subtextLabel = config?.subtextLabel !== undefined && config?.subtextLabel !== null
        ? String(config.subtextLabel).trim()
        : "";
    const rawSubtextSize = Number(config?.subtextFontSize);
    const subtextFontSize = Number.isFinite(rawSubtextSize) && rawSubtextSize >= 6 && rawSubtextSize <= 24
        ? Math.round(rawSubtextSize)
        : 10;
    const subtextFontColor = (config?.subtextFontColor && config.subtextFontColor.trim().length > 0)
        ? config.subtextFontColor
        : "#6b7280";

    return {
        show,
        fontFamily,
        fontSize,
        fontColor,
        bold,
        contentMode,
        position,
        decimalPlaces,
        showSubtext,
        subtextLabel,
        subtextFontSize,
        subtextFontColor
    };
}

/**
 * Resolves the reference subtext label using custom wording or default logic.
 * Interpolates tokens {reference} or [Reference] (case-insensitive) if present.
 */
export function resolveSubtextLabel(customText: string | undefined | null, referenceName: string): string {
    const trimmed = customText ? customText.trim() : "";
    if (!trimmed) {
        return referenceName === "Meta" ? "da Meta" : `de ${referenceName}`;
    }
    if (/\[reference\]|\{reference\}/i.test(trimmed)) {
        return trimmed.replace(/\[reference\]|\{reference\}/gi, referenceName);
    }
    return trimmed;
}

/**
 * Resolves node corner radius clamped between 0 and 20px (default 3px).
 */
export function resolveNodeCornerRadius(radius: number | undefined | null): number {
    if (radius === undefined || radius === null || !Number.isFinite(Number(radius))) return 3;
    return Math.max(0, Math.min(20, Math.round(Number(radius))));
}

/**
 * Resolves minimum node height clamped between 2 and 50px (default 4px).
 */
export function resolveMinNodeHeight(minHeight: number | undefined | null): number {
    if (minHeight === undefined || minHeight === null || !Number.isFinite(Number(minHeight))) return 4;
    return Math.max(2, Math.min(50, Math.round(Number(minHeight))));
}

/**
 * Calculates horizontal coordinate and SVG text-anchor based on label position mode.
 */
export function resolveLabelPosition(
    position: LabelPosition | string | undefined,
    nodeX: number,
    nodeWidth: number
): { x: number; textAnchor: "start" | "middle" | "end" } {
    if (position === "right") {
        return {
            x: nodeX + nodeWidth + 8,
            textAnchor: "start"
        };
    }
    if (position === "center") {
        return {
            x: nodeX + nodeWidth / 2,
            textAnchor: "middle"
        };
    }
    return {
        x: nodeX - 8,
        textAnchor: "end"
    };
}

/**
 * Builds lines of text to be rendered for a node label based on selected content mode.
 */
export function buildNodeLabelLines(options: {
    name: string;
    formattedValue: string;
    contentMode: LabelContentMode | string;
    referenceText?: string | null;
    showSubtext?: boolean;
}): NodeLabelLine[] {
    const { name, formattedValue, contentMode, referenceText, showSubtext } = options;
    const lines: NodeLabelLine[] = [];

    switch (contentMode) {
        case "nameOnly":
            lines.push({ text: name });
            break;
        case "valueOnly":
            lines.push({ text: formattedValue });
            break;
        case "nameAboveValue":
            lines.push({ text: name });
            lines.push({ text: formattedValue });
            break;
        case "nameAndValue":
        default:
            lines.push({ text: `${name} (${formattedValue})` });
            break;
    }

    if (showSubtext !== false && referenceText && referenceText.trim().length > 0) {
        lines.push({ text: referenceText.trim(), isSubtext: true });
    }

    return lines;
}

/**
 * Resolves dimmed element opacity during hover highlight clamped between 0.05 and 0.50 (default 0.12).
 * Supports both direct fractions (e.g. 0.12) and percentage values (e.g. 12).
 */
export function resolveDimmedOpacity(opacity: number | undefined | null): number {
    if (opacity === undefined || opacity === null || !Number.isFinite(Number(opacity))) return 0.12;
    const num = Number(opacity);
    if (num > 1) {
        return Math.max(0.05, Math.min(0.50, Math.round(num) / 100));
    }
    return Math.max(0.05, Math.min(0.50, Math.round(num * 100) / 100));
}

/**
 * Resolves visual background color. Returns "transparent" if transparent is enabled,
 * otherwise returns sanitized solid hex color or fallback (#FFFFFF).
 */
export function resolveVisualBackground(
    transparent: boolean | undefined | null,
    color: string | undefined | null
): string {
    if (transparent === true) return "transparent";
    if (!color || typeof color !== "string" || color.trim().length === 0) return "#FFFFFF";
    return color.trim();
}

/**
 * Resolves canvas margin/padding clamped between 0 and 600px.
 */
export function resolveCanvasPadding(padding: number | undefined | null, fallback: number): number {
    if (padding === undefined || padding === null || !Number.isFinite(Number(padding))) return fallback;
    return Math.max(0, Math.min(600, Math.round(Number(padding))));
}

/**
 * Computes SVG viewBox string given content boundaries and horizontal padding.
 */
export function computeViewBox(
    minY: number,
    maxY: number,
    maxX: number,
    paddingLeft: number | undefined | null,
    paddingRight: number | undefined | null
): string {
    const left = resolveCanvasPadding(paddingLeft, 170);
    const right = resolveCanvasPadding(paddingRight, 250);
    const width = Math.max(1, maxX + left + right);
    const height = Math.max(1, maxY - minY + 80);
    return `${-left} ${minY - 40} ${width} ${height}`;
}

/**
 * Extracts slot-based node assignments (slotIndex -> nodeName) from metadata.objects.nodeOrderConfig.$instances.
 */
export function parseSlotAssignments(
    instances: Record<string, Record<string, unknown>> | undefined | null
): Map<number, string> {
    const slotMap = new Map<number, string>();
    if (!instances) return slotMap;

    Object.keys(instances).forEach(key => {
        const obj = instances[key];
        if (!obj || !("node" in obj)) return;
        const nodeName = resolveReferenceNodeName(obj["node"]);
        const match = key.match(/\d+/);
        if (match && nodeName && nodeName !== "(Nenhum)") {
            const index = parseInt(match[0], 10);
            slotMap.set(index, nodeName);
        }
    });

    return slotMap;
}

/**
 * Reads per-node and slot-based order overrides from metadata.objects.nodeOrderConfig.$instances.
 * Supports slot dropdowns ("slot_0", "slot_1" with property "node") as well as direct node-order maps.
 */
export function parseNodeOrderOverrides(
    instances: Record<string, Record<string, unknown>> | undefined | null
): Map<string, number> {
    const orderMap = new Map<string, number>();
    if (!instances) return orderMap;

    const slotEntries: Array<{ index: number; nodeName: string }> = [];

    Object.keys(instances).forEach(key => {
        const obj = instances[key];
        if (!obj) return;

        if ("node" in obj) {
            const nodeName = resolveReferenceNodeName(obj["node"]);
            if (nodeName && nodeName !== "(Nenhum)") {
                const match = key.match(/\d+/);
                const index = match ? parseInt(match[0], 10) : slotEntries.length;
                slotEntries.push({ index, nodeName });
            }
        } else if ("order" in obj) {
            const order = obj["order"];
            if (order !== undefined && order !== null && Number.isFinite(Number(order))) {
                orderMap.set(key, Number(order));
            }
        }
    });

    if (slotEntries.length > 0) {
        slotEntries.sort((a, b) => a.index - b.index);
        slotEntries.forEach(({ nodeName }, rank) => {
            if (!orderMap.has(nodeName)) {
                orderMap.set(nodeName, rank + 1);
            }
        });
    }

    return orderMap;
}

/**
 * Resolves node name from an ItemDropdown value, object, or raw string.
 */
export function resolveReferenceNodeName(val: unknown): string {
    if (!val) return "";
    let resolved = "";
    if (typeof val === "string") {
        resolved = val.trim();
    } else if (typeof val === "object" && val !== null && "value" in val) {
        const inner = (val as { value?: unknown }).value;
        if (typeof inner === "string") resolved = inner.trim();
        else if (typeof inner === "number") resolved = String(inner);
    } else if (typeof val === "object" && val !== null && "displayName" in val) {
        const d = (val as { displayName?: unknown }).displayName;
        if (typeof d === "string") resolved = d.trim();
    }
    return resolved === "(Nenhum)" ? "" : resolved;
}

/**
 * Extracts unique non-empty node names from categorical category columns.
 */
export function extractNodeNamesFromCategories(categories?: powerbi.DataViewCategoryColumn[]): string[] {
    if (!categories) return [];
    const names = new Set<string>();
    const sourceCat = categories.find(c => c.source?.roles?.["source"]);
    const targetCat = categories.find(c => c.source?.roles?.["target"]);
    if (sourceCat?.values) {
        sourceCat.values.forEach(v => {
            if (v != null) {
                const s = String(v).trim();
                if (s && s !== "(Nenhum)") names.add(s);
            }
        });
    }
    if (targetCat?.values) {
        targetCat.values.forEach(v => {
            if (v != null) {
                const s = String(v).trim();
                if (s && s !== "(Nenhum)") names.add(s);
            }
        });
    }
    return Array.from(names);
}
