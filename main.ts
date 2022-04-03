import { Plugin, MarkdownView, PluginSettingTab, Setting } from "obsidian";
import { gutter, GutterMarker } from "@codemirror/gutter";
import { EditorView } from "@codemirror/view";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import _ from "lodash";

function generateId(): string {
	return Math.random().toString(36).substr(2, 6);
}

function findListItem(text, line, itemType) {
	const ast = unified().use(remarkParse).parse(text);
	const allItems = [];
	visit(ast, itemType, (node, index, parent) => {
		const start = node.position.start.line;
		const end = node.position.end.line;
		if (start <= line && end >= line)
			allItems.push({
				node,
				parent,
				index,
				height: end - start,
			});
	});
	return _.minBy(allItems, "height");
}

const dragHandle = (line) =>
	new (class extends GutterMarker {
		toDOM() {
			const handle = document.createElement("div");
			handle.appendChild(document.createTextNode(":::"));
			handle.className = "gutter-marker";
			handle.setAttribute("draggable", true);
			handle.addEventListener("dragstart", (e) =>
				e.dataTransfer.setData("line", line)
			);
			return handle;
		}
	})();

const dragLineMarker = gutter({
	lineMarker(view, line) {
		return line.from == line.to
			? null
			: dragHandle(view.state.doc.lineAt(line.from).number);
	},
});

function shouldInsertAfter(block) {
	if (block.type) {
		return [
			"blockquote",
			"code",
			"table",
			"comment",
			"footnoteDefinition",
		].includes(block.type);
	}
}

function getBlock(app, line, file) {
	const fileCache = app.metadataCache.getFileCache(file);
	const findSection = (section) => {
		return (
			section.position.start.line <= line &&
			section.position.end.line >= line
		);
	};

	let block = (fileCache?.sections || []).find(findSection);
	if (block?.type === "list") {
		block = (fileCache?.listItems || []).find(findSection);
	} else if (block?.type === "heading") {
		block = fileCache.headings.find((heading) => {
			return heading.position.start.line === block.position.start.line;
		});
	}

	// return block id if it exists
	if (block.id) return { id: block.id, changes: [] };

	// generate and write block id
	const id = generateId();
	const spacer = shouldInsertAfter(block) ? "\n\n" : " ";

	return {
		id,
		changes: [
			{ from: block.position.end.offset, insert: spacer + "^" + id },
		],
	};
}

function processDrop(app, event, settings) {
	const sourceLineNum = parseInt(event.dataTransfer.getData("line"), 10);
	const targetLinePos = event.target.cmView.posAtStart;

	const view = app.workspace.getActiveViewOfType(MarkdownView);

	if (!view || !view.editor) return;

	const sourceEditor = view.editor;
	const targetEditor = event.target.cmView.editorView;

	const targetLine = targetEditor.state.doc.lineAt(targetLinePos);

	const modifier = event.ctrlKey
		? "ctrl"
		: event.shiftKey
		? "shift"
		: event.altKey
		? "alt"
		: "simple";

	console.log(event);

	const type = sourceEditor.cm == targetEditor ? "move" : settings[modifier];
	const text = sourceEditor.getValue();
	const item = findListItem(text, sourceLineNum, "listItem");
	if (item) {
		const from = item.node.position.start.offset;
		const to = item.node.position.end.offset;
		let operations;

		if (type === "move") {
			const sourceLine = sourceEditor.cm.state.doc.lineAt(from);

			const deleteOp = { from: Math.max(sourceLine.from - 1, 0), to };
			const computeIndent = (line) => line.text.match(/^\t*/)[0].length;

			const textToInsert = "\n" + text.slice(sourceLine.from, to);
			const sourceIndent = computeIndent(sourceLine);
			const targetIndent = computeIndent(targetLine);

			const addTabs = Math.max(targetIndent - sourceIndent + 1, 0);
			const removeTabs = Math.max(sourceIndent - targetIndent - 1, 0);

			const removeTabsRegex = new RegExp(
				"\n" + "\t".repeat(removeTabs),
				"g"
			);
			const addTabsRegex = "\n" + "\t".repeat(addTabs);

			const indentedText = textToInsert.replace(
				removeTabsRegex,
				addTabsRegex
			);
			const insertOp = {
				from: targetLine.to,
				insert: indentedText,
			};

			operations = { source: [deleteOp], target: [insertOp] };
		} else if (type === "embed") {
			const { id, changes } = getBlock(app, sourceLineNum - 1, view.file);
			const insertBlockOp = {
				from: targetLine.to,
				insert: ` ![[${view.file.basename}#^${id}]]`,
			};

			operations = { source: [changes], target: [insertBlockOp] };
		}

		const { source, target } = operations;
		if (sourceEditor.cm == targetEditor)
			sourceEditor.cm.dispatch({ changes: [...source, ...target] });
		else {
			sourceEditor.cm.dispatch({ changes: source });
			targetEditor.dispatch({ changes: target });
		}
	}
}

const DEFAULT_SETTINGS = {
	simple: "embed",
	ctrl: "move",
	shift: "copy",
	alt: "none",
};

export default class DragNDropPlugin extends Plugin {
	async onload() {
		const app = this.app;
		const settings = await this.loadSettings();
		this.addSettingTab(new DragNDropSettings(this.app, this));
		this.registerEditorExtension(dragLineMarker);
		this.registerEditorExtension(
			EditorView.domEventHandlers({
				dragover(event, view) {
					// add class to element
					const target = event.target;
					if (target.classList.contains("HyperMD-list-line")) {
						target.classList.add("drag-over");
						event.preventDefault();
					}
				},
				dragleave(event, view) {
					// remove class from element
					const target = event.target;
					target.classList.remove("drag-over");
				},
				drop(event, viewDrop) {
					processDrop(app, event, settings);
				},
			})
		);
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
		console.log("save", this.settings);
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

		const addDropdownVariants = (settingName) => (dropDown) => {
			console.log("set value", this.plugin.settings[settingName]);

			dropDown.addOption("none", "Do nothing");
			dropDown.addOption("embed", "Embed link");
			dropDown.addOption("copy", "Copy block");
			dropDown.addOption("move", "Move block");
			dropDown.setValue(this.plugin.settings[settingName]);
			dropDown.onChange(async (value) => {
				this.plugin.settings[settingName] = value;
				await this.plugin.saveSettings();
			});
		};

		new Setting(containerEl)
			.setName("Drag'n'drop without modifiers")
			.addDropdown(addDropdownVariants("simple"));

		new Setting(containerEl)
			.setName("Drag'n'drop with Cmd/Ctrl")
			.addDropdown(addDropdownVariants("ctrl"));

		new Setting(containerEl)
			.setName("Drag'n'drop with Shift")
			.addDropdown(addDropdownVariants("shift"));

		new Setting(containerEl)
			.setName("Drag'n'drop with Alt/Meta")
			.addDropdown(addDropdownVariants("alt"));
	}
}
