import {
	Plugin,
	MarkdownView,
	PluginSettingTab,
	Setting,
	App,
	CachedMetadata,
	ListItemCache,
	SectionCache,
	DropdownComponent,
} from "obsidian";
import { gutter, GutterMarker } from "@codemirror/gutter";
import _ from "lodash";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit, Node } from "unist-util-visit";
import { RangeSetBuilder } from "@codemirror/rangeset";
import { Line } from "@codemirror/text";
import {
	Decoration,
	EditorView,
	ViewPlugin,
	DecorationSet,
	BlockInfo,
} from "@codemirror/view";

const dragHighlight = Decoration.line({ attributes: { class: "drag-over" } });
const dragDestination = Decoration.line({ attributes: { class: "drag-last" } });

type RemarkNode = {
	node: Node;
	parent: Node;
	height: number;
};

function findListItem(
	text: string,
	line: number,
	itemType: "listItem" | "paragraph"
): RemarkNode {
	const ast = unified().use(remarkParse).parse(text);
	const allItems: RemarkNode[] = [];
	visit(ast, itemType, (node, index, parent) => {
		const start = node.position.start.line;
		const end = node.position.end.line;
		if (start <= line && end >= line)
			allItems.push({
				node,
				parent,
				height: end - start,
			});
	});
	return _.minBy(allItems, "height");
}

function generateId(): string {
	return Math.random().toString(36).substr(2, 6);
}

function copyItemLinesToDragContainer(app: App, line: number, drag: Element) {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view || !view.editor) return;
	const targetEditor: EditorView = view.editor.cm;
	const lineHandle = targetEditor.state.doc.line(line);
	const lineDom = targetEditor.domAtPos(lineHandle.from).node;
	const lines = getAllLinesForCurrentItem(app, lineDom, targetEditor);

	const container = document.createElement("div");
	container.className =
		"markdown-source-view mod-cm6 cm-content dnd-drag-container";

	// copy tab-size from any editor to drag handle - to correctly indent items
	const cmContent = document.querySelector(
		".cm-contentContainer .cm-content"
	);
	if (cmContent)
		container.setAttribute("style", cmContent.getAttribute("style"));

	lines.forEach(({ lineDom }) =>
		container.appendChild(lineDom.cloneNode(true))
	);
	drag.appendChild(container);
	document.body.classList.add("dnd-render-draggable-content");
	setTimeout(() => {
		container.classList.add("dnd-drag-container-inactive");
		document.body.classList.remove("dnd-render-draggable-content");
	}, 0);
}

const dragHandle = (line: number, app: App) =>
	new (class extends GutterMarker {
		toDOM(editor: EditorView) {
			const fileCache = findFile(app, editor);
			const block = (fileCache?.sections || []).find((s) =>
				findSection(s, line - 1)
			);
			const drag = document.createElement("div");
			if (!block || block.type !== "list") return drag;
			drag.appendChild(document.createTextNode(":::"));
			drag.className = "dnd-gutter-marker";
			drag.setAttribute("draggable", "true");
			drag.addEventListener("dragstart", (e) => {
				e.dataTransfer.setData("line", `${line}`);
				copyItemLinesToDragContainer(app, line, drag);
			});
			return drag;
		}
	})();

const dragLineMarker = (app: App) =>
	gutter({
		lineMarker(view: EditorView, line: BlockInfo) {
			return line.from == line.to
				? null
				: dragHandle(view.state.doc.lineAt(line.from).number, app);
		},
	});

function getAllChildrensOfBlock(
	parents: ListItemCache[],
	allItems: ListItemCache[]
): ListItemCache[] {
	if (!parents.length) return [];

	// Deconstruct hierarchy according to
	// https://github.com/obsidianmd/obsidian-api/blob/036708710c4a4b652d8166c5929d5ba1ffb7fb91/obsidian.d.ts#L1581
	// parentItem.position.start.line === childItem.parent
	const idx = new Set(_.map(parents, (parent) => parent.position.start.line));
	const childrens = _.filter(allItems, ({ parent }) => idx.has(parent));

	const nestedChildrens = getAllChildrensOfBlock(childrens, allItems);

	return [...parents, ...childrens, ...nestedChildrens];
}

function findSection(section: ListItemCache | SectionCache, line: number) {
	return (
		section.position.start.line <= line && section.position.end.line >= line
	);
}

function getBlock(line: number, fileCache: CachedMetadata) {
	const block = (fileCache?.listItems || []).find((s) =>
		findSection(s, line)
	);
	if (!block) return;
	const allChildren = _.uniq(
		getAllChildrensOfBlock([block], fileCache.listItems)
	);

	// generate and write block id
	const id = generateId();
	const changes = {
		from: block.position.end.offset,
		insert: " ^" + id,
	};
	const fromLine = _.minBy(allChildren, "position.start.line").position.start;
	const toLine = _.maxBy(allChildren, "position.end.line").position.end;

	return {
		...block,
		fromLine,
		toLine,
		id: block.id || id,
		children: allChildren,
		changes: block.id ? [] : [changes],
	};
}

function defineOperationType(
	event: DragEvent,
	settings: DndPluginSettings,
	isSameEditor: boolean
) {
	const modifier = event.shiftKey ? "shift" : event.altKey ? "alt" : "simple";

	if (modifier === "simple") {
		if (isSameEditor) return settings["simple_same_pane"];
		else return settings["simple_different_panes"];
	} else return settings[modifier];
}

function processDrop(app: App, event: DragEvent, settings: DndPluginSettings) {
	const sourceLineNum = parseInt(event.dataTransfer.getData("line"), 10);
	const targetLinePos = event.target.cmView.posAtStart;

	const view = app.workspace.getActiveViewOfType(MarkdownView);

	if (!view || !view.editor) return;

	const sourceEditor: EditorView = view.editor.cm;
	const targetEditor: EditorView = event.target.cmView.editorView;

	const targetLine = targetEditor.state.doc.lineAt(targetLinePos);

	const isSameEditor = sourceEditor == targetEditor;

	const type = defineOperationType(event, settings, isSameEditor);

	if (type === "none") return;

	const text = view.editor.getValue();
	const item = findListItem(text, sourceLineNum, "listItem");
	if (item) {
		const from = item.node.position.start.offset;
		const to = item.node.position.end.offset;
		let operations;

		const targetItem = findListItem(
			targetEditor.state.toJSON().doc,
			targetLine.number,
			"paragraph"
		);

		// if line was not moved or moved inside it's enclosing block - do nothing
		if (isSameEditor) {
			const pos = item.node.position;
			if (
				targetLine.number >= pos.start.line &&
				targetLine.number <= pos.end.line
			) {
				console.log("Moved inside same block - do nothing");
				return;
			}
		}

		const targetItemLastLine =
			targetItem.node.position.end.offset || targetLine.to;

		if (type === "move" || type === "copy") {
			const sourceLine = sourceEditor.state.doc.lineAt(from);

			const textToInsert = "\n" + text.slice(sourceLine.from, to);

			// adjust indent for each line of the source block
			const computeIndent = (line: Line) =>
				line.text.match(/^\t*/)[0].length;

			const sourceIndent = computeIndent(sourceLine);
			const targetIndent = computeIndent(targetLine);

			const addTabsNum = Math.max(targetIndent - sourceIndent + 1, 0);
			const removeTabsNum = Math.max(sourceIndent - targetIndent - 1, 0);

			const removeTabsRegex = new RegExp(
				"\n" + "\t".repeat(removeTabsNum),
				"g"
			);
			const addTabsRegex = "\n" + "\t".repeat(addTabsNum);

			const indentedText = textToInsert.replace(
				removeTabsRegex,
				addTabsRegex
			);

			// build operations for applying with editor
			const deleteOp = { from: Math.max(sourceLine.from - 1, 0), to };
			const insertOp = { from: targetItemLastLine, insert: indentedText };

			operations = {
				source: type === "move" ? [deleteOp] : [],
				target: [insertOp],
			};
		} else if (type === "embed") {
			const sourceFile = findFile(app, sourceEditor);
			const { id, changes } = getBlock(sourceLineNum - 1, sourceFile);
			const insertBlockOp = {
				from: targetItemLastLine,
				insert: ` ![[${view.file.basename}#^${id}]]`,
			};

			operations = { source: [changes], target: [insertBlockOp] };
		}

		console.log("Move item", type, operations);
		const { source, target } = operations;
		if (sourceEditor == targetEditor)
			sourceEditor.dispatch({ changes: [...source, ...target] });
		else {
			sourceEditor.dispatch({ changes: source });
			targetEditor.dispatch({ changes: target });
		}
		targetEditor.focus();
	}
}

function findFile(app: App, targetEditor: EditorView) {
	const leafs = app.workspace.getLeavesOfType("markdown");
	const targetLeaf = _.find(leafs, (leaf) => {
		const view: MarkdownView = leaf.view as MarkdownView;
		return view?.editor?.cm === targetEditor;
	});
	if (targetLeaf)
		return app.metadataCache.getFileCache(
			(targetLeaf.view as MarkdownView).file
		);
}

function getAllLinesForCurrentItem(
	app: App,
	lineDom: globalThis.Node,
	targetEditor: EditorView
) {
	const doc = targetEditor.state.doc;
	const posAtLine = targetEditor.posAtDOM(lineDom);
	const targetLine = doc.lineAt(posAtLine);

	const targetFile = findFile(app, targetEditor);
	const block = getBlock(targetLine.number - 1, targetFile);
	if (!block) return;

	const targetItemLastLine = block.position.end.line + 1;

	return _.range(block.fromLine.line + 1, block.toLine.line + 1 + 1)
		.map((lineNum) => ({
			lineDom: targetEditor.domAtPos(doc.line(lineNum).from).node,
			line: doc.line(lineNum),
			isTargetLine: lineNum === targetItemLastLine,
		}))
		.filter(({ line }) => !!line);
}

function emptyRange(): DecorationSet {
	return new RangeSetBuilder<Decoration>().finish();
}

let lineHightlight: DecorationSet = emptyRange();

function highlightWholeItem(app: App, target: Element) {
	try {
		const allLines = getAllLinesForCurrentItem(
			app,
			target.closest(".cm-line"),
			target.cmView.editorView
		);

		const builder = new RangeSetBuilder<Decoration>();
		_.forEach(allLines, ({ line, isTargetLine }) => {
			builder.add(line.from, line.from, dragHighlight);
			if (isTargetLine)
				builder.add(line.from, line.from, dragDestination);
		});
		lineHightlight = builder.finish();
	} catch (e) {
		if (
			e.message.match(
				/Trying to find position for a DOM position outside of the document/
			)
		)
			return;
		throw e;
	}
}

interface DndPluginSettings {
	simple_same_pane: OperationType;
	simple_different_panes: OperationType;
	shift: OperationType;
	alt: OperationType;
}

type OperationType = "move" | "embed" | "copy" | "none";

const DEFAULT_SETTINGS: DndPluginSettings = {
	simple_same_pane: "move",
	simple_different_panes: "embed",
	shift: "copy",
	alt: "none",
};

const showHighlight = ViewPlugin.fromClass(class {}, {
	decorations: (v) => {
		return lineHightlight;
	},
});

export default class DragNDropPlugin extends Plugin {
	settings: DndPluginSettings;

	async onload() {
		const app = this.app;
		const settings = await this.loadSettings();
		const dragEventHandlers = EditorView.domEventHandlers({
			dragover(event) {
				event.preventDefault();
			},
			dragenter(event) {
				if (event.target instanceof Element)
					highlightWholeItem(app, event.target);
				event.preventDefault();
			},
			drop(event) {
				processDrop(app, event, settings);
				lineHightlight = emptyRange();
			},
		});
		this.addSettingTab(new DragNDropSettings(this.app, this));
		this.registerEditorExtension([
			dragLineMarker(app),
			showHighlight,
			dragEventHandlers,
		]);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
		return this.settings;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class DragNDropSettings extends PluginSettingTab {
	plugin: DragNDropPlugin;

	constructor(app: App, plugin: DragNDropPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", {
			text: "Modifiers",
		});

		const addDropdownVariants =
			(settingName: keyof DndPluginSettings) =>
			(dropDown: DropdownComponent) => {
				dropDown.addOption("none", "Do nothing");
				dropDown.addOption("embed", "Embed link");
				dropDown.addOption("copy", "Copy block");
				dropDown.addOption("move", "Move block");
				dropDown.setValue(this.plugin.settings[settingName]);
				dropDown.onChange(async (value: OperationType) => {
					this.plugin.settings[settingName] = value;
					await this.plugin.saveSettings();
				});
			};

		new Setting(containerEl)
			.setName("Drag'n'drop without modifiers in the same pane")
			.addDropdown(addDropdownVariants("simple_same_pane"));

		new Setting(containerEl)
			.setName("Drag'n'drop without modifiers in the different panes")
			.addDropdown(addDropdownVariants("simple_different_panes"));

		new Setting(containerEl)
			.setName("Drag'n'drop with Shift")
			.addDropdown(addDropdownVariants("shift"));

		new Setting(containerEl)
			.setName("Drag'n'drop with Alt/Meta")
			.addDropdown(addDropdownVariants("alt"));
	}
}
