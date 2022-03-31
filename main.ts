import { Plugin, MarkdownView } from "obsidian";
import { gutter, GutterMarker } from "@codemirror/gutter";
import { EditorView } from "@codemirror/view";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import _ from "lodash";

function findListItem(text, line) {
	const ast = unified().use(remarkParse).parse(text);
	const allItems = [];
	visit(ast, ["listItem"], (node, index, parent) => {
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

function processDrop(app, event) {
	const sourceLine = parseInt(event.dataTransfer.getData("line"), 10);

	const view = app.workspace.getActiveViewOfType(MarkdownView);

	if (!view || !view.editor) return;

	const sourceEditor = view.editor;
	const targetEditor = event.target.cmView.editorView;
	const targetLine = event.target.cmView.editorView.state.doc.lineAt(
		event.target.cmView.posAtStart
	);

	const text = sourceEditor.getValue();
	const item = findListItem(text, sourceLine);
	if (item) {
		const from = item.node.position.start.offset;
		const to = item.node.position.end.offset;

		const deleteOp = { from: from - 1, to };

		const textToInsert = "\n" + text.slice(from, to);
		const firstLineIndent = targetLine.text.match(/^\t*/)[0].length + 1;
		const textToInsertWithTabs = textToInsert.replace(
			/\n/g,
			"\n" + "\t".repeat(firstLineIndent)
		);
		const insertOp = { from: targetLine.to, insert: textToInsertWithTabs };

		if (sourceEditor.cm == targetEditor)
			sourceEditor.cm.dispatch({ changes: [deleteOp, insertOp] });
		else {
			sourceEditor.cm.dispatch({ changes: [deleteOp] });
			targetEditor.dispatch({ changes: [insertOp] });
		}
	}
}

export default class MyPlugin extends Plugin {
	async onload() {
		const app = this.app;
		this.registerEditorExtension(dragLineMarker);
		this.registerEditorExtension(
			EditorView.domEventHandlers({
				dragover(event, view) {
					// add class to element
					const target = event.target as HTMLElement;
					if (target.classList.contains("HyperMD-list-line")) {
						target.classList.add("drag-over");
						event.preventDefault();
					}
				},
				dragleave(event, view) {
					// remove class from element
					const target = event.target as HTMLElement;
					target.classList.remove("drag-over");
				},
				drop(event, viewDrop) {
					processDrop(app, event);
				},
			})
		);
	}
}
