import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService, formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";
import "./../style/visual.less";
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import DataView = powerbi.DataView;
import { VisualFormattingSettingsModel, SankeyConfigCardSettings } from "./settings";
import {
    assignFallbackColors,
    assignLevels,
    buildGraph,
    computeValues,
    EdgeInput,
    layoutVertical,
    ModelLink,
    ModelNode,
    ColumnAlign,
    LinkColorMode,
    computeLinkPath,
    resolveLinkCurvature,
    resolveLinkFill,
    resolveLinkOpacity,
    buildNodeLabelLines,
    formatCompactValue,
    resolveLabelPosition,
    resolveLabelTypography,
    resolveSubtextLabel,
    resolveNodeCornerRadius,
    resolveMinNodeHeight,
    resolveDimmedOpacity,
    resolveVisualBackground,
    computeViewBox,
    parseNodeOrderOverrides,
    parseSlotAssignments,
    resolveReferenceNodeName,
    extractNodeNamesFromCategories
} from "./model";

const DEFAULT_PALETTE: readonly string[] = [
    "#4e79a7", "#f28e2c", "#e15759", "#76b7b2", "#59a14f",
    "#edc949", "#af7aa1", "#ff9da7", "#9c755f", "#bab0ab",
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"
];

let visualInstanceCounter = 0;

export class Visual implements IVisual {
    private readonly container: HTMLElement;
    private readonly svg: SVGSVGElement;
    private readonly defs: SVGDefsElement;
    private readonly viewport: SVGGElement;
    private readonly linkLayer: SVGGElement;
    private readonly nodeLayer: SVGGElement;
    private readonly tooltip: HTMLElement;
    private readonly emptyState: HTMLElement;
    private readonly controls: HTMLElement;
    private readonly host: IVisualHost;
    private readonly selectionManager: ISelectionManager;

    private readonly visualId = `sankey-${++visualInstanceCounter}`;
    private linkCurvature = 0.5;
    private formattingSettings: VisualFormattingSettingsModel = new VisualFormattingSettingsModel();
    private nodes: ModelNode[] = [];
    private links: ModelLink[] = [];
    private nodeWidth = 16;
    private scale = 1;
    private translateX = 0;
    private translateY = 0;
    private pan?: { x: number; y: number; tx: number; ty: number };
    private linkScale = 1;
    private readonly initialPos = new Map<string, { x: number; y: number }>();
    private valueFormat?: string;
    private readonly selectionIds = new Map<string, powerbi.visuals.ISelectionId>();
    private readonly colorOverrides = new Map<string, string>();
    private readonly nodeOrderOverrides = new Map<string, number>();
    private readonly slotOrderAssignments = new Map<number, string>();
    private fallbackColors = new Map<string, string>();

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.selectionManager = options.host.createSelectionManager();
        const namespace = "http://www.w3.org/2000/svg";
        this.container = document.createElement("div");
        this.container.className = "sankey-container";

        this.svg = document.createElementNS(namespace, "svg");
        this.svg.classList.add("sankey-svg");
        this.defs = document.createElementNS(namespace, "defs");
        this.viewport = document.createElementNS(namespace, "g");
        this.linkLayer = document.createElementNS(namespace, "g");
        this.nodeLayer = document.createElementNS(namespace, "g");
        this.viewport.append(this.linkLayer, this.nodeLayer);
        this.svg.append(this.defs, this.viewport);

        this.tooltip = document.createElement("div");
        this.tooltip.className = "sankey-tooltip";

        this.emptyState = document.createElement("div");
        this.emptyState.className = "sankey-empty";
        this.emptyState.textContent = "Sem dados para exibir";

        this.controls = document.createElement("div");
        this.controls.className = "sankey-controls";
        this.controls.append(
            this.control("+", "Aproximar", () => this.zoom(1.2)),
            this.control("−", "Afastar", () => this.zoom(1 / 1.2)),
            this.control("↺", "Redefinir layout e zoom", () => this.resetView(), "reset")
        );

        this.container.append(this.svg, this.controls, this.tooltip, this.emptyState);
        options.element.appendChild(this.container);

        this.svg.addEventListener("wheel", event => this.onWheel(event), { passive: false });
        this.svg.addEventListener("pointerdown", event => {
            if ((event.target as HTMLElement).closest(".node, .sankey-control")) return;
            this.selectionManager.clear();
            this.startPan(event);
        });
        this.svg.addEventListener("contextmenu", (event: MouseEvent) => {
            if ((event.target as HTMLElement).closest(".node")) return;
            event.preventDefault();
            this.selectionManager.showContextMenu({} as any, {
                x: event.clientX,
                y: event.clientY
            });
        });
        window.addEventListener("pointermove", event => this.movePan(event));
        window.addEventListener("pointerup", () => this.endPan());
    }

    public update(options: VisualUpdateOptions): void {
        // Extract node names from incoming dataView categories and any existing nodes
        const categorical = options.dataViews?.[0]?.categorical;
        const catNames = extractNodeNamesFromCategories(categorical?.categories);
        const allNames = new Set<string>(catNames);
        this.nodes.forEach(n => {
            if (n.name && n.name.trim()) allNames.add(n.name.trim());
        });

        // Also check raw saved values in objects so legacy/persisted settings don't get wiped by populate
        const sankeyObjects = options.dataViews?.[0]?.metadata?.objects?.["sankeyConfig"];
        const rawSavedSource = sankeyObjects?.["referenceFlowSource"];
        const rawSavedTarget = sankeyObjects?.["referenceFlowTarget"];
        const savedSourceStr = typeof rawSavedSource === "string" ? rawSavedSource.trim() : "";
        const savedTargetStr = typeof rawSavedTarget === "string" ? rawSavedTarget.trim() : "";
        if (savedSourceStr && savedSourceStr !== "(Nenhum)") allNames.add(savedSourceStr);
        if (savedTargetStr && savedTargetStr !== "(Nenhum)") allNames.add(savedTargetStr);

        const nodeItems: powerbi.IEnumMember[] = [
            { value: "", displayName: "(Nenhum)" }
        ];
        allNames.forEach(name => {
            nodeItems.push({ value: name, displayName: name });
        });

        // Supply availableNodeItems to SankeyConfigCardSettings BEFORE populateFormattingSettingsModel
        SankeyConfigCardSettings.availableNodeItems = nodeItems;

        const service = new FormattingSettingsService();
        this.formattingSettings = service.populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);

        // Fallback safeguard: if populate didn't resolve an item, set it explicitly
        const currentSourceVal = resolveReferenceNodeName(this.formattingSettings.sankeyConfig.referenceFlowSource.value) || savedSourceStr;
        if (currentSourceVal) {
            const matchedSource = nodeItems.find(i => i.value === currentSourceVal)
                || { value: currentSourceVal, displayName: currentSourceVal };
            this.formattingSettings.sankeyConfig.referenceFlowSource.value = matchedSource;
        }

        const currentTargetVal = resolveReferenceNodeName(this.formattingSettings.sankeyConfig.referenceFlowTarget.value) || savedTargetStr;
        if (currentTargetVal) {
            const matchedTarget = nodeItems.find(i => i.value === currentTargetVal)
                || { value: currentTargetVal, displayName: currentTargetVal };
            this.formattingSettings.sankeyConfig.referenceFlowTarget.value = matchedTarget;
        }

        this.nodeWidth = this.setting(this.formattingSettings.sankeyConfig.nodeWidth.value, 16);

        // Update link flow settings
        const linkConfig = this.formattingSettings.linkConfig;
        const { resting, hover } = resolveLinkOpacity(linkConfig?.linkOpacity?.value);
        this.container.style.setProperty("--link-opacity", String(resting));
        this.container.style.setProperty("--link-hover-opacity", String(hover));
        this.linkCurvature = resolveLinkCurvature(linkConfig?.linkCurvature?.value);

        // Update interaction and navigation settings
        const interactionConfig = this.formattingSettings.interactionConfig;
        const showZoomControls = interactionConfig?.showZoomControls?.value !== false;
        this.controls.style.display = showZoomControls ? "" : "none";
        const dimmedOpacity = resolveDimmedOpacity(interactionConfig?.dimmedOpacity?.value);
        this.container.style.setProperty("--dimmed-opacity", String(dimmedOpacity));

        // Update canvas background settings
        const canvasConfig = this.formattingSettings.canvasConfig;
        const isTransparent = canvasConfig?.transparentBackground?.value === true;
        const bgColor = resolveVisualBackground(
            isTransparent,
            canvasConfig?.backgroundColor?.value?.value
        );
        this.container.style.setProperty("--visual-background", bgColor);

        // Parse edge data for Sankey graph
        const parsed = this.parseEdges(options.dataViews);
        this.clear();
        this.resetView();

        if (!parsed || !parsed.edges.length) {
            this.emptyState.classList.add("visible");
            return;
        }

        this.emptyState.classList.remove("visible");
        this.valueFormat = parsed.valueFormat;
        this.buildLayout(parsed.edges, options.viewport.height || 500);

        // Update available node items if new graph nodes were discovered
        if (this.nodes.length) {
            const currentItemVals = new Set(SankeyConfigCardSettings.availableNodeItems.map(i => i.value));
            let added = false;
            this.nodes.forEach(n => {
                if (n.name && !currentItemVals.has(n.name)) {
                    SankeyConfigCardSettings.availableNodeItems.push({ value: n.name, displayName: n.name });
                    added = true;
                }
            });
            if (added) {
                this.formattingSettings.sankeyConfig.referenceFlowSource.items = SankeyConfigCardSettings.availableNodeItems;
                this.formattingSettings.sankeyConfig.referenceFlowTarget.items = SankeyConfigCardSettings.availableNodeItems;
            }
        }

        if (!this.links.length) {
            this.emptyState.classList.add("visible");
            return;
        }

        this.render();
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const sankeyConfig = this.formattingSettings.sankeyConfig;
        const currentSource = resolveReferenceNodeName(sankeyConfig.referenceFlowSource.value);
        const currentTarget = resolveReferenceNodeName(sankeyConfig.referenceFlowTarget.value);

        sankeyConfig.referenceFlowSource.items = SankeyConfigCardSettings.availableNodeItems;
        sankeyConfig.referenceFlowSource.value = SankeyConfigCardSettings.availableNodeItems.find(i => i.value === currentSource)
            || { value: currentSource, displayName: currentSource || "(Nenhum)" };

        sankeyConfig.referenceFlowTarget.items = SankeyConfigCardSettings.availableNodeItems;
        sankeyConfig.referenceFlowTarget.value = SankeyConfigCardSettings.availableNodeItems.find(i => i.value === currentTarget)
            || { value: currentTarget, displayName: currentTarget || "(Nenhum)" };

        // Dynamic per-node color slices
        this.formattingSettings.nodeColors.slices = [];
        this.nodes.forEach(node => {
            const slice = new formattingSettings.ColorPicker({
                name: "fill",
                displayName: node.name,
                value: { value: this.nodeColor(node.name) },
                // Static per-name selector: Power BI stores one color instance per
                // node name (under metadata.objects.nodeColors.$instances). This is
                // isolated from the shared source/target scope identity, so editing
                // one node no longer changes its edge partner. See parseColorOverrides.
                selector: { id: node.name } as powerbi.data.Selector,
                defaultColor: { value: this.nodeColor(node.name) },
            });
            this.formattingSettings.nodeColors.slices.push(slice);
        });

        // Dynamic per-slot order dropdown slices
        this.formattingSettings.nodeOrderConfig.slices = [];
        const availableItems: powerbi.IEnumMember[] = [
            { value: "", displayName: "(Nenhum)" }
        ];
        const knownNodeNames = new Set<string>();
        this.nodes.forEach(n => {
            if (n.name && !knownNodeNames.has(n.name)) {
                knownNodeNames.add(n.name);
                availableItems.push({ value: n.name, displayName: n.name });
            }
        });
        this.slotOrderAssignments.forEach(name => {
            if (name && !knownNodeNames.has(name)) {
                knownNodeNames.add(name);
                availableItems.push({ value: name, displayName: name });
            }
        });

        const maxSavedSlot = this.slotOrderAssignments.size > 0
            ? Math.max(...Array.from(this.slotOrderAssignments.keys())) + 1
            : 0;
        const slotCount = Math.max(this.nodes.length, maxSavedSlot);

        for (let i = 0; i < slotCount; i++) {
            const slotId = `slot_${i}`;
            const assignedNode = this.slotOrderAssignments.get(i) || "";
            const matchedValue = availableItems.find(item => item.value === assignedNode)
                || { value: assignedNode, displayName: assignedNode || "(Nenhum)" };

            const slice = new formattingSettings.ItemDropdown({
                name: "node",
                displayName: `${i + 1}º Nó`,
                items: availableItems,
                value: matchedValue,
                selector: { id: slotId } as powerbi.data.Selector
            });
            this.formattingSettings.nodeOrderConfig.slices.push(slice);
        }

        return new FormattingSettingsService().buildFormattingModel(this.formattingSettings);
    }

    private parseEdges(dataViews?: DataView[]): { edges: EdgeInput[]; valueFormat?: string } | undefined {
        const categoricalView = dataViews?.find(dv => !!dv.categorical);
        const categorical = categoricalView?.categorical;
        const categories = categorical?.categories;
        const source = categories?.find(c => c.source.roles?.["source"]);
        const target = categories?.find(c => c.source.roles?.["target"]);
        const descricao = categories?.find(c => c.source.roles?.["descricao"]);
        const valueCol = categorical?.values?.find(v => v.source.roles?.["value"]);
        const levelCol = categorical?.values?.find(v => v.source.roles?.["level"]);
        if (!source || !target || !valueCol) return undefined;

        this.selectionIds.clear();
        this.colorOverrides.clear();
        this.nodeOrderOverrides.clear();
        this.slotOrderAssignments.clear();

        // Selection ids drive the context menu and cross-highlight only. Node colors
        // are NOT keyed off them: source and target share one per-row scope identity,
        // so a data-bound color selector cannot tell a row's source node apart from
        // its target node. Colors are persisted per node name instead — see
        // parseColorOverrides / getFormattingModel.
        const buildSelectionIds = (cat?: powerbi.DataViewCategoryColumn) => {
            if (!cat) return;
            cat.values.forEach((raw, i) => {
                const name = String(raw);
                if (!this.selectionIds.has(name) && this.host?.createSelectionIdBuilder) {
                    this.selectionIds.set(name, this.host.createSelectionIdBuilder().withCategory(cat, i).createSelectionId());
                }
            });
        };
        buildSelectionIds(source);
        buildSelectionIds(target);
        this.parseColorOverrides(categoricalView);
        this.parseNodeOrderOverrides(categoricalView);

        const edges: EdgeInput[] = source.values.map((raw, i) => ({
            source: String(raw),
            target: String(target.values[i]),
            value: Number(valueCol.values[i]) || 0,
            level: levelCol ? Number(levelCol.values[i]) : undefined,
            description: descricao ? String(descricao.values[i]) : undefined,
        }));
        return { edges, valueFormat: valueCol.source.format };
    }

    /**
     * Reads per-node color overrides set through the format pane. Each color picker
     * persists with a static `{ id: nodeName }` selector, so Power BI returns them as
     * a keyed instance map under `metadata.objects.nodeColors.$instances`. This is
     * deliberately independent of categorical scope identities, which source and
     * target nodes share per row and therefore cannot use to tell two nodes apart.
     */
    private parseColorOverrides(dataView?: DataView): void {
        const instances = dataView?.metadata?.objects?.["nodeColors"]?.["$instances"] as powerbi.DataViewObjectMap | undefined;
        if (!instances) return;
        Object.keys(instances).forEach(name => {
            const fill = instances[name]?.["fill"] as powerbi.Fill | undefined;
            if (fill?.solid?.color) {
                this.colorOverrides.set(name, fill.solid.color);
            }
        });
    }

    /**
     * Reads per-node and slot-based ordering overrides set through the format pane.
     * Supports slot dropdowns with `{ id: "slot_0" }` selectors as well as legacy numeric order inputs.
     */
    private parseNodeOrderOverrides(dataView?: DataView): void {
        this.nodeOrderOverrides.clear();
        this.slotOrderAssignments.clear();
        const instances = dataView?.metadata?.objects?.["nodeOrderConfig"]?.["$instances"] as Record<string, Record<string, unknown>> | undefined;
        if (!instances) return;
        const slots = parseSlotAssignments(instances);
        slots.forEach((nodeName, idx) => this.slotOrderAssignments.set(idx, nodeName));
        const parsed = parseNodeOrderOverrides(instances);
        parsed.forEach((val, key) => this.nodeOrderOverrides.set(key, val));
    }


    private buildLayout(edges: EdgeInput[], viewportHeight: number): void {
        const graph = buildGraph(edges);
        const explicitLevels = new Map<string, number>();
        edges.forEach(edge => {
            if (Number.isFinite(edge.level) && edge.level! >= 0) {
                const existing = explicitLevels.get(edge.target);
                explicitLevels.set(edge.target, existing === undefined ? edge.level! : Math.min(existing, edge.level!));
            }
        });
        assignLevels(graph, explicitLevels);
        const config = this.formattingSettings.sankeyConfig;
        const source = resolveReferenceNodeName(config.referenceFlowSource?.value);
        const target = resolveReferenceNodeName(config.referenceFlowTarget?.value);
        computeValues(graph, config.allowReferenceFlowMismatch.value && source && target ? { source, target } : undefined);
        this.nodes = graph.nodes;
        this.links = graph.links;
        this.fallbackColors = assignFallbackColors(this.nodes.map(node => node.name), DEFAULT_PALETTE);
        const totals = new Map<number, number>();
        this.nodes.forEach(node => totals.set(node.level, (totals.get(node.level) || 0) + node.value));
        const factor = Math.max(380, viewportHeight - 80) / Math.max(...totals.values(), 1);
        this.linkScale = factor;
        const spacing = this.setting(this.formattingSettings.sankeyConfig.columnSpacing.value, 380);
        const minHeight = resolveMinNodeHeight(this.formattingSettings.sankeyConfig.minNodeHeight?.value);
        this.nodes.forEach(node => { node.height = Math.max(minHeight, node.value * factor); node.x = node.level * spacing; });
        const align = (this.formattingSettings.sankeyConfig.columnAlign.value.value as ColumnAlign) || "center";
        layoutVertical(
            graph,
            this.setting(this.formattingSettings.sankeyConfig.nodePadding.value, 45),
            align,
            [],
            this.nodeOrderOverrides
        );
        this.layoutLinks(factor);
        this.initialPos.clear();
        this.nodes.forEach(node => this.initialPos.set(node.name, { x: node.x, y: node.y }));
        const minY = Math.min(...this.nodes.map(n => n.y));
        const maxY = Math.max(...this.nodes.map(n => n.y + n.height));
        const maxX = Math.max(...this.nodes.map(n => n.x + this.nodeWidth));
        const paddingLeft = this.formattingSettings.canvasConfig?.paddingLeft?.value;
        const paddingRight = this.formattingSettings.canvasConfig?.paddingRight?.value;
        this.svg.setAttribute("viewBox", computeViewBox(minY, maxY, maxX, paddingLeft, paddingRight));
        this.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    }

    private layoutLinks(factor: number): void {
        const nodes = new Map(this.nodes.map(node => [node.name, node]));
        this.nodes.forEach(node => {
            let offset = Math.max(0, node.height - this.sum(node.outgoing) * factor);
            node.outgoing
                .sort((left, right) => (nodes.get(left.target)?.y || 0) - (nodes.get(right.target)?.y || 0))
                .forEach(link => {
                    link.sourceHeight = link.value * factor;
                    link.y0 = offset;
                    offset += link.sourceHeight;
                });
            offset = Math.max(0, node.height - this.sum(node.incoming) * factor);
            node.incoming
                .sort((left, right) => (nodes.get(left.source)?.y || 0) - (nodes.get(right.source)?.y || 0))
                .forEach(link => {
                    link.targetHeight = link.value * factor;
                    link.y1 = offset;
                    offset += link.targetHeight;
                });
        });
    }

    private render(): void {
        const namespace = "http://www.w3.org/2000/svg";
        const byName = new Map(this.nodes.map(node => [node.name, node]));
        const linkConfig = this.formattingSettings.linkConfig;
        const colorMode = (linkConfig?.linkColorMode?.value?.value || linkConfig?.linkColorMode?.value || "target") as LinkColorMode;
        const neutralColor = linkConfig?.linkNeutralColor?.value?.value || "#D1D5DB";

        this.links.forEach((link, index) => {
            const element = document.createElementNS(namespace, "path");
            element.classList.add("link");

            const sourceColor = this.nodeColor(link.source);
            const targetColor = this.nodeColor(link.target);
            let gradId: string | undefined;

            if (colorMode === "gradient") {
                gradId = `${this.visualId}-grad-${index}`;
                const grad = document.createElementNS(namespace, "linearGradient");
                grad.id = gradId;
                grad.setAttribute("gradientUnits", "objectBoundingBox");
                grad.setAttribute("x1", "0%");
                grad.setAttribute("y1", "0%");
                grad.setAttribute("x2", "100%");
                grad.setAttribute("y2", "0%");

                const stop0 = document.createElementNS(namespace, "stop");
                stop0.setAttribute("offset", "0%");
                stop0.setAttribute("stop-color", sourceColor);

                const stop1 = document.createElementNS(namespace, "stop");
                stop1.setAttribute("offset", "100%");
                stop1.setAttribute("stop-color", targetColor);

                grad.append(stop0, stop1);
                this.defs.appendChild(grad);
            }

            const fill = resolveLinkFill({
                mode: colorMode,
                sourceColor,
                targetColor,
                neutralColor,
                gradientId: gradId
            });
            element.setAttribute("fill", fill);
            element.addEventListener("mouseenter", () => this.highlight(link.target));
            element.addEventListener("mousemove", event => this.showTooltip(event, link.target, link.value, byName.get(link.target)?.description));
            element.addEventListener("mouseleave", () => { this.resetHighlight(); this.hideTooltip(); });
            this.linkLayer.appendChild(element);
        });
        const cornerRadius = resolveNodeCornerRadius(this.formattingSettings.sankeyConfig.nodeCornerRadius?.value);
        this.nodes.forEach(node => {
            const group = document.createElementNS(namespace, "g");
            group.classList.add("node");
            group.dataset.name = node.name;

            const bar = document.createElementNS(namespace, "rect");
            bar.classList.add("node-bar");
            bar.setAttribute("width", String(this.nodeWidth));
            bar.setAttribute("rx", String(cornerRadius));
            bar.setAttribute("fill", this.nodeColor(node.name));

            const label = document.createElementNS(namespace, "text");
            label.classList.add("node-label");

            group.append(bar, label);
            group.addEventListener("mouseenter", () => this.highlight(node.name));
            group.addEventListener("mousemove", event => this.showTooltip(event, node.name, node.value, node.description, this.referencePercent(node)));
            group.addEventListener("mouseleave", () => { this.resetHighlight(); this.hideTooltip(); });
            group.addEventListener("pointerdown", event => this.dragNode(event, node));
            group.addEventListener("contextmenu", (event: MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                const selectionId = this.selectionIds.get(node.name);
                if (selectionId) {
                    this.selectionManager.showContextMenu(selectionId, {
                        x: event.clientX,
                        y: event.clientY
                    });
                }
            });
            this.nodeLayer.appendChild(group);
        });
        this.updateGeometry();
    }

    private updateGeometry(): void {
        const byName = new Map(this.nodes.map(node => [node.name, node]));
        Array.from(this.linkLayer.children).forEach((element, index) => (element as SVGPathElement).setAttribute("d", this.path(this.links[index], byName)));
        const reference = this.referenceNode();
        const cornerRadius = resolveNodeCornerRadius(this.formattingSettings.sankeyConfig.nodeCornerRadius?.value);
        const labelsCard = this.formattingSettings.nodeLabels;
        const fontColorVal = typeof labelsCard?.fontColor?.value === "string"
            ? labelsCard.fontColor.value
            : labelsCard?.fontColor?.value?.value;
        const subtextFontColorVal = typeof labelsCard?.subtextFontColor?.value === "string"
            ? labelsCard.subtextFontColor.value
            : labelsCard?.subtextFontColor?.value?.value;
        const typography = resolveLabelTypography({
            show: labelsCard?.show?.value,
            fontFamily: labelsCard?.fontFamily?.value,
            fontSize: labelsCard?.fontSize?.value,
            fontColor: fontColorVal,
            bold: labelsCard?.bold?.value,
            labelContentMode: String(labelsCard?.labelContentMode?.value?.value ?? ""),
            labelPosition: String(labelsCard?.labelPosition?.value?.value ?? ""),
            decimalPlaces: labelsCard?.decimalPlaces?.value,
            showSubtext: labelsCard?.showSubtext?.value,
            subtextLabel: labelsCard?.subtextLabel?.value,
            subtextFontSize: labelsCard?.subtextFontSize?.value,
            subtextFontColor: subtextFontColorVal
        });

        Array.from(this.nodeLayer.children).forEach((element, index) => {
            const node = this.nodes[index];
            const bar = element.querySelector("rect")!;
            const label = element.querySelector("text")!;
            bar.setAttribute("x", String(node.x));
            bar.setAttribute("y", String(node.y));
            bar.setAttribute("height", String(node.height));
            bar.setAttribute("rx", String(cornerRadius));

            if (!typography.show) {
                label.style.display = "none";
                return;
            }
            label.style.display = "";
            label.style.fontFamily = typography.fontFamily;
            label.style.fontSize = `${typography.fontSize}px`;
            label.style.fill = typography.fontColor;
            label.style.fontWeight = typography.bold ? "600" : "400";

            const pos = resolveLabelPosition(typography.position, node.x, this.nodeWidth);
            label.setAttribute("text-anchor", pos.textAnchor);

            const units = this.formattingSettings.sankeyConfig.valueDisplayUnits.value.value;
            const labelValue = units === "format"
                ? this.format(node.value, typography.decimalPlaces)
                : units === "none"
                    ? (typography.decimalPlaces !== null
                        ? node.value.toLocaleString("pt-BR", { minimumFractionDigits: typography.decimalPlaces, maximumFractionDigits: typography.decimalPlaces })
                        : Math.round(node.value).toLocaleString("pt-BR"))
                    : formatCompactValue(node.value, typography.decimalPlaces);

            let refText: string | undefined;
            if (typography.showSubtext && node.level > 0 && reference && reference.value > 0) {
                const labelText = resolveSubtextLabel(typography.subtextLabel, reference.name);
                refText = `${Math.round((node.value / reference.value) * 100)}% ${labelText}`;
            }

            const lines = buildNodeLabelLines({
                name: node.name,
                formattedValue: labelValue,
                contentMode: typography.contentMode,
                referenceText: refText,
                showSubtext: typography.showSubtext
            });

            const totalLines = lines.length;
            const lineHeight = Math.round(typography.fontSize * 1.25);
            const midY = node.y + node.height / 2;
            const startY = midY - ((totalLines - 1) * lineHeight) / 2;

            let tspans = Array.from(label.querySelectorAll("tspan"));
            while (tspans.length < totalLines) {
                const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
                label.appendChild(tspan);
                tspans.push(tspan);
            }
            while (tspans.length > totalLines) {
                const tspan = tspans.pop()!;
                tspan.remove();
            }

            lines.forEach((line, lineIndex) => {
                const tspan = tspans[lineIndex];
                tspan.textContent = line.text;
                tspan.setAttribute("x", String(pos.x));
                tspan.setAttribute("y", String(startY + lineIndex * lineHeight));
                if (line.isSubtext) {
                    tspan.classList.add("subtext");
                    tspan.style.fontSize = `${typography.subtextFontSize}px`;
                    tspan.style.fill = typography.subtextFontColor;
                    tspan.style.fontWeight = "500";
                } else {
                    tspan.classList.remove("subtext");
                    tspan.style.fontSize = "";
                    tspan.style.fill = "";
                    tspan.style.fontWeight = "";
                }
            });
        });
    }

    private dragNode(event: PointerEvent, node: ModelNode): void {
        event.stopPropagation();
        const startX = event.clientX;
        const startY = event.clientY;
        const originalX = node.x;
        const originalY = node.y;
        let hasMoved = false;

        const move = (moveEvent: PointerEvent): void => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            if (Math.hypot(dx, dy) > 4) {
                hasMoved = true;
            }
            node.x = originalX + dx / this.scale;
            node.y = originalY + dy / this.scale;
            this.layoutLinks(this.linkScale);
            this.updateGeometry();
        };

        const end = (): void => {
            window.removeEventListener("pointermove", move);
            if (!hasMoved) {
                const selectionId = this.selectionIds.get(node.name);
                if (selectionId) {
                    this.selectionManager.select(selectionId);
                }
            }
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end, { once: true });
    }

    private path(link: ModelLink, nodes: Map<string, ModelNode>): string {
        const source = nodes.get(link.source);
        const target = nodes.get(link.target);
        if (!source || !target) return "";
        const sx = source.x + this.nodeWidth;
        const tx = target.x;
        const sy0 = source.y + (link.y0 || 0);
        const sy1 = sy0 + (link.sourceHeight || 0);
        const ty0 = target.y + (link.y1 || 0);
        const ty1 = ty0 + (link.targetHeight || 0);
        return computeLinkPath(sx, sy0, sy1, tx, ty0, ty1, this.linkCurvature);
    }

    private highlight(name: string): void {
        const nodeNames = new Set<string>([name]);
        const links = new Set<ModelLink>();
        const visit = (nodeName: string, direction: "incoming" | "outgoing"): void => {
            this.nodes.find(node => node.name === nodeName)?.[direction].forEach(link => {
                links.add(link);
                const next = direction === "incoming" ? link.source : link.target;
                if (!nodeNames.has(next)) {
                    nodeNames.add(next);
                    visit(next, direction);
                }
            });
        };
        visit(name, "incoming");
        visit(name, "outgoing");
        Array.from(this.nodeLayer.children).forEach((element, index) => element.classList.toggle("dimmed", !nodeNames.has(this.nodes[index]?.name)));
        Array.from(this.linkLayer.children).forEach((element, index) => element.classList.toggle("dimmed", !links.has(this.links[index])));
    }

    private resetHighlight(): void {
        Array.from(this.nodeLayer.children).concat(Array.from(this.linkLayer.children)).forEach(element => element.classList.remove("dimmed"));
    }

    private clear(): void {
        this.linkLayer.replaceChildren();
        this.nodeLayer.replaceChildren();
        this.defs.replaceChildren();
        this.nodes = [];
        this.links = [];
        this.hideTooltip();
    }

    private control(label: string, title: string, action: () => void, className?: string): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `sankey-control ${className || ""}`;
        button.textContent = label;
        button.title = title;
        button.addEventListener("click", action);
        return button;
    }

    private setting(value: number, fallback: number): number {
        return Number.isFinite(value) && value > 0 ? value : fallback;
    }

    private sum(links: ModelLink[]): number {
        return links.reduce((total, link) => total + link.value, 0);
    }

    private format(value: number, decimalPlaces?: number | null): string {
        if (this.valueFormat) {
            try {
                return valueFormatter.format(value, this.valueFormat);
            } catch {
            }
        }
        return this.formatCompact(value, decimalPlaces);
    }

    private formatCompact(value: number, decimalPlaces?: number | null): string {
        const decimals = decimalPlaces !== undefined ? decimalPlaces : this.formattingSettings.nodeLabels?.decimalPlaces?.value;
        return formatCompactValue(value, decimals);
    }

    private zoom(factor: number, clientX?: number, clientY?: number): void {
        const newScale = Math.min(4, Math.max(.5, this.scale * factor));
        if (newScale === this.scale) return;
        const center = this.zoomCenter(clientX, clientY);
        this.translateX = center.x - (center.x - this.translateX) / this.scale * newScale;
        this.translateY = center.y - (center.y - this.translateY) / this.scale * newScale;
        this.scale = newScale;
        this.transform();
    }

    private resetView(): void {
        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;
        this.transform();
        this.nodes.forEach(node => {
            const initial = this.initialPos.get(node.name);
            if (!initial) return;
            node.x = initial.x;
            node.y = initial.y;
        });
        this.layoutLinks(this.linkScale);
        this.updateGeometry();
    }

    private transform(): void {
        this.viewport.setAttribute("transform", `translate(${this.translateX},${this.translateY}) scale(${this.scale})`);
    }

    private onWheel(event: WheelEvent): void {
        const enableWheelZoom = this.formattingSettings?.interactionConfig?.enableWheelZoom?.value !== false;
        if (!enableWheelZoom) return;
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        this.zoom(factor, event.clientX, event.clientY);
    }

    private startPan(event: PointerEvent): void {
        if ((event.target as HTMLElement).closest(".node, .sankey-control")) return;
        this.pan = { x: event.clientX, y: event.clientY, tx: this.translateX, ty: this.translateY };
        this.container.classList.add("panning");
    }

    private movePan(event: PointerEvent): void {
        if (!this.pan) return;
        this.translateX = this.pan.tx + event.clientX - this.pan.x;
        this.translateY = this.pan.ty + event.clientY - this.pan.y;
        this.transform();
    }

    private endPan(): void {
        this.pan = undefined;
        this.container.classList.remove("panning");
    }

    private nodeColor(name: string): string {
        const override = this.colorOverrides.get(name);
        if (override) return override;
        const hostColor = this.host?.colorPalette?.getColor?.(name)?.value;
        if (hostColor) return hostColor;
        return this.fallbackColors.get(name) ?? DEFAULT_PALETTE[0];
    }

    private zoomCenter(clientX?: number, clientY?: number): { x: number; y: number } {
        const ctm = this.svg.getScreenCTM();
        if (clientX !== undefined && clientY !== undefined && ctm) {
            const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
            return { x: point.x, y: point.y };
        }
        const box = this.svg.viewBox.baseVal;
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }

    private referenceNode(): ModelNode | undefined {
        return this.nodes.filter(node => node.incoming.length === 0 && node.value > 0)
            .sort((left, right) => right.value - left.value)[0];
    }

    private referencePercent(node: ModelNode): number | undefined {
        const reference = this.referenceNode();
        return reference && reference !== node && reference.value > 0
            ? Math.round((node.value / reference.value) * 100)
            : undefined;
    }

    private showTooltip(event: MouseEvent, title: string, value: number, help?: string, percent?: number): void {
        this.tooltip.replaceChildren();
        const heading = document.createElement("strong");
        heading.textContent = title;
        const amount = document.createElement("div");
        amount.className = "tooltip-val";
        amount.textContent = `Valor: ${this.format(value)}`;
        this.tooltip.append(heading, amount);
        if (percent !== undefined) {
            const part = document.createElement("div");
            part.className = "tooltip-meta";
            part.textContent = `Participação: ${percent}%`;
            this.tooltip.appendChild(part);
        }
        if (help) {
            const description = document.createElement("div");
            description.className = "tooltip-meta";
            description.textContent = help;
            this.tooltip.appendChild(description);
        }
        const rect = this.container.getBoundingClientRect();
        this.tooltip.style.display = "block";
        this.tooltip.style.left = `${Math.max(4, Math.min(event.clientX - rect.left + 12, rect.width - this.tooltip.offsetWidth - 4))}px`;
        this.tooltip.style.top = `${Math.max(4, Math.min(event.clientY - rect.top + 12, rect.height - this.tooltip.offsetHeight - 4))}px`;
    }

    private hideTooltip(): void {
        this.tooltip.style.display = "none";
    }
}
