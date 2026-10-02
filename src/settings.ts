"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * Sankey Layout Formatting Card
 */
export class SankeyConfigCardSettings extends FormattingSettingsCard {
    nodeWidth = new formattingSettings.NumUpDown({
        name: "nodeWidth",
        displayName: "Largura do Nó (px)",
        value: 16
    });

    nodePadding = new formattingSettings.NumUpDown({
        name: "nodePadding",
        displayName: "Espaçamento Vertical (px)",
        value: 45
    });

    columnSpacing = new formattingSettings.NumUpDown({
        name: "columnSpacing",
        displayName: "Espaçamento Entre Colunas (px)",
        value: 380
    });

    allowReferenceFlowMismatch = new formattingSettings.ToggleSwitch({
        name: "allowReferenceFlowMismatch",
        displayName: "Permitir valores diferentes",
        description: "Mantém o valor da origem e dimensiona o link pelo fluxo de saída do destino.",
        value: true
    });

    public static availableNodeItems: powerbi.IEnumMember[] = [
        { value: "", displayName: "(Nenhum)" }
    ];

    referenceFlowSource = new formattingSettings.ItemDropdown({
        name: "referenceFlowSource",
        displayName: "Nó de origem da referência",
        items: [...SankeyConfigCardSettings.availableNodeItems],
        value: SankeyConfigCardSettings.availableNodeItems[0]
    });

    referenceFlowTarget = new formattingSettings.ItemDropdown({
        name: "referenceFlowTarget",
        displayName: "Nó de destino da referência",
        items: [...SankeyConfigCardSettings.availableNodeItems],
        value: SankeyConfigCardSettings.availableNodeItems[0]
    });

    columnAlign = new formattingSettings.ItemDropdown({
        name: "columnAlign",
        displayName: "Alinhamento da Coluna",
        items: [
            { value: "center", displayName: "Centro" },
            { value: "bottom", displayName: "Inferior" },
            { value: "top", displayName: "Superior" }
        ],
        value: { value: "center", displayName: "Centro" }
    });

    valueDisplayUnits = new formattingSettings.ItemDropdown({
        name: "valueDisplayUnits",
        displayName: "Unidades do Rótulo",
        items: [
            { value: "compact", displayName: "Compacto (K/M/B)" },
            { value: "format", displayName: "Formato da medida" },
            { value: "none", displayName: "Nenhum" }
        ],
        value: { value: "compact", displayName: "Compacto (K/M/B)" }
    });

    nodeCornerRadius = new formattingSettings.NumUpDown({
        name: "nodeCornerRadius",
        displayName: "Arredondamento dos Nós (px)",
        value: 3
    });

    minNodeHeight = new formattingSettings.NumUpDown({
        name: "minNodeHeight",
        displayName: "Altura Mínima do Nó (px)",
        value: 4
    });

    name: string = "sankeyConfig";
    displayName: string = "Configurações do Sankey";
    slices: Array<FormattingSettingsSlice> = [
        this.nodeWidth,
        this.nodePadding,
        this.columnSpacing,
        this.nodeCornerRadius,
        this.minNodeHeight,
        this.allowReferenceFlowMismatch,
        this.referenceFlowSource,
        this.referenceFlowTarget,
        this.columnAlign,
        this.valueDisplayUnits
    ];

    constructor() {
        super();
        this.referenceFlowSource.items = [...SankeyConfigCardSettings.availableNodeItems];
        this.referenceFlowTarget.items = [...SankeyConfigCardSettings.availableNodeItems];
        if (!this.referenceFlowSource.value) {
            this.referenceFlowSource.value = SankeyConfigCardSettings.availableNodeItems[0];
        }
        if (!this.referenceFlowTarget.value) {
            this.referenceFlowTarget.value = SankeyConfigCardSettings.availableNodeItems[0];
        }
    }
}

/**
 * Per-node color card
 */
export class NodeColorsCardSettings extends FormattingSettingsCard {
    name: string = "nodeColors";
    displayName: string = "Cores dos Nós";
    slices: Array<FormattingSettingsSlice> = [];
}

/**
 * Per-node order card
 */
export class NodeOrderCardSettings extends FormattingSettingsCard {
    name: string = "nodeOrderConfig";
    displayName: string = "Ordem dos Nós";
    description: string = "Defina a ordem dos nós selecionando o nó desejado em cada posição.";
    slices: Array<FormattingSettingsSlice> = [];
}

/**
 * Link (Flow Ribbon) Formatting Card
 */
export class LinkConfigCardSettings extends FormattingSettingsCard {
    linkOpacity = new formattingSettings.Slider({
        name: "linkOpacity",
        displayName: "Opacidade (%)",
        value: 45
    });

    linkColorMode = new formattingSettings.ItemDropdown({
        name: "linkColorMode",
        displayName: "Modo de Cor",
        items: [
            { value: "target", displayName: "Cor do Destino" },
            { value: "source", displayName: "Cor da Origem" },
            { value: "gradient", displayName: "Gradiente (Origem ➔ Destino)" },
            { value: "neutral", displayName: "Cor Neutra Fixa" }
        ],
        value: { value: "target", displayName: "Cor do Destino" }
    });

    linkNeutralColor = new formattingSettings.ColorPicker({
        name: "linkNeutralColor",
        displayName: "Cor Neutra Fixa",
        value: { value: "#D1D5DB" }
    });

    linkCurvature = new formattingSettings.Slider({
        name: "linkCurvature",
        displayName: "Curvatura do Fluxo",
        value: 0.5
    });

    name: string = "linkConfig";
    displayName: string = "Fluxos / Conexões";
    slices: Array<FormattingSettingsSlice> = [
        this.linkOpacity,
        this.linkColorMode,
        this.linkNeutralColor,
        this.linkCurvature
    ];

    onPreProcess(): void {
        const mode = typeof this.linkColorMode.value === "object"
            ? (this.linkColorMode.value as any)?.value
            : this.linkColorMode.value;
        this.linkNeutralColor.visible = mode === "neutral";
    }
}

/**
 * Node Data Labels Formatting Card
 */
export class NodeLabelsCardSettings extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Exibir Rótulos",
        value: true
    });

    fontFamily = new formattingSettings.FontPicker({
        name: "fontFamily",
        displayName: "Fonte",
        value: "Segoe UI"
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Tamanho da Fonte (pt)",
        value: 13
    });

    fontColor = new formattingSettings.ColorPicker({
        name: "fontColor",
        displayName: "Cor da Fonte",
        value: { value: "#2c3e50" }
    });

    bold = new formattingSettings.ToggleSwitch({
        name: "bold",
        displayName: "Negrito",
        value: true
    });

    labelContentMode = new formattingSettings.ItemDropdown({
        name: "labelContentMode",
        displayName: "Conteúdo do Rótulo",
        items: [
            { value: "nameAndValue", displayName: "Nome e Valor" },
            { value: "nameOnly", displayName: "Apenas Nome" },
            { value: "valueOnly", displayName: "Apenas Valor" },
            { value: "nameAboveValue", displayName: "Nome acima, Valor abaixo" }
        ],
        value: { value: "nameAndValue", displayName: "Nome e Valor" }
    });

    labelPosition = new formattingSettings.ItemDropdown({
        name: "labelPosition",
        displayName: "Posição do Rótulo",
        items: [
            { value: "left", displayName: "À Esquerda" },
            { value: "right", displayName: "À Direita" },
            { value: "center", displayName: "Centralizado no Nó" }
        ],
        value: { value: "left", displayName: "À Esquerda" }
    });

    decimalPlaces = new formattingSettings.NumUpDown({
        name: "decimalPlaces",
        displayName: "Casas Decimais",
        value: -1
    });

    showSubtext = new formattingSettings.ToggleSwitch({
        name: "showSubtext",
        displayName: "Exibir % de Referência",
        value: true
    });

    subtextLabel = new formattingSettings.TextInput({
        name: "subtextLabel",
        displayName: "Texto do Subtexto",
        placeholder: "Vazio = auto (ex: da Meta, atingimento)",
        value: ""
    });

    subtextFontSize = new formattingSettings.NumUpDown({
        name: "subtextFontSize",
        displayName: "Tamanho do Subtexto (pt)",
        value: 10
    });

    subtextFontColor = new formattingSettings.ColorPicker({
        name: "subtextFontColor",
        displayName: "Cor do Subtexto",
        value: { value: "#6b7280" }
    });

    name: string = "nodeLabels";
    displayName: string = "Rótulos de Dados";

    constructor() {
        super();
        this.topLevelSlice = this.show;
        this.slices = [
            this.fontFamily,
            this.fontSize,
            this.fontColor,
            this.bold,
            this.labelContentMode,
            this.labelPosition,
            this.decimalPlaces,
            this.showSubtext,
            this.subtextLabel,
            this.subtextFontSize,
            this.subtextFontColor
        ];
    }

    onPreProcess(): void {
        const isVisible = this.show.value !== false;
        this.fontFamily.visible = isVisible;
        this.fontSize.visible = isVisible;
        this.fontColor.visible = isVisible;
        this.bold.visible = isVisible;
        this.labelContentMode.visible = isVisible;
        this.labelPosition.visible = isVisible;
        this.decimalPlaces.visible = isVisible;
        this.showSubtext.visible = isVisible;

        const isSubtextVisible = isVisible && this.showSubtext.value !== false;
        this.subtextLabel.visible = isSubtextVisible;
        this.subtextFontSize.visible = isSubtextVisible;
        this.subtextFontColor.visible = isSubtextVisible;
    }
}

/**
 * Interactive Controls & Navigation Formatting Card
 */
export class InteractionConfigCardSettings extends FormattingSettingsCard {
    showZoomControls = new formattingSettings.ToggleSwitch({
        name: "showZoomControls",
        displayName: "Exibir Controles de Zoom",
        value: true
    });

    enableWheelZoom = new formattingSettings.ToggleSwitch({
        name: "enableWheelZoom",
        displayName: "Zoom com Rolagem do Mouse",
        description: "Permite usar a roda do mouse para aproximar ou afastar o gráfico.",
        value: true
    });

    dimmedOpacity = new formattingSettings.Slider({
        name: "dimmedOpacity",
        displayName: "Opacidade Não Destacados (%)",
        value: 12
    });

    name: string = "interactionConfig";
    displayName: string = "Navegação e Interação";
    slices: Array<FormattingSettingsSlice> = [
        this.showZoomControls,
        this.enableWheelZoom,
        this.dimmedOpacity
    ];
}

/**
 * Canvas Background & Margins Formatting Card
 */
export class CanvasConfigCardSettings extends FormattingSettingsCard {
    transparentBackground = new formattingSettings.ToggleSwitch({
        name: "transparentBackground",
        displayName: "Fundo Transparente",
        value: false
    });

    backgroundColor = new formattingSettings.ColorPicker({
        name: "backgroundColor",
        displayName: "Cor do Fundo",
        value: { value: "#FFFFFF" }
    });

    paddingLeft = new formattingSettings.NumUpDown({
        name: "paddingLeft",
        displayName: "Margem Esquerda (px)",
        value: 170
    });

    paddingRight = new formattingSettings.NumUpDown({
        name: "paddingRight",
        displayName: "Margem Direita (px)",
        value: 250
    });

    name: string = "canvasConfig";
    displayName: string = "Tela e Margens";
    slices: Array<FormattingSettingsSlice> = [
        this.transparentBackground,
        this.backgroundColor,
        this.paddingLeft,
        this.paddingRight
    ];

    onPreProcess(): void {
        const isTransparent = this.transparentBackground.value === true;
        this.backgroundColor.visible = !isTransparent;
    }
}

/**
 * Visual formatting settings model class
 */
export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    sankeyConfig = new SankeyConfigCardSettings();
    linkConfig = new LinkConfigCardSettings();
    nodeLabels = new NodeLabelsCardSettings();
    nodeColors = new NodeColorsCardSettings();
    nodeOrderConfig = new NodeOrderCardSettings();
    interactionConfig = new InteractionConfigCardSettings();
    canvasConfig = new CanvasConfigCardSettings();
    cards = [
        this.sankeyConfig,
        this.linkConfig,
        this.nodeLabels,
        this.nodeColors,
        this.nodeOrderConfig,
        this.interactionConfig,
        this.canvasConfig
    ];
}

