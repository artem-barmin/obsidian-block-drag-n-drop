import { Plugin, MarkdownView } from "obsidian";
import { gutter, GutterMarker } from "@codemirror/gutter";
import { EditorView } from "@codemirror/view";
import { remark } from "remark";
import { visit } from "unist-util-visit";
import _ from "lodash";

function findListItem(text, line) {
	return new Promise((resolve, reject) => {
		remark()
			.use(() => (ast) => {
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
				resolve(_.minBy(allItems, "height"));
				return ast;
			})
			.process(text, function (err, file) {});
	});
}

const emptyMarker = (line) =>
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

const emptyLineGutter = gutter({
	lineMarker(view, line) {
		return line.from == line.to
			? null
			: emptyMarker(view.state.doc.lineAt(line.from).number);
	},
});

async function processDrop(app, event) {
	const sourceLine = parseInt(event.dataTransfer.getData("line"), 10);

	const view = app.workspace.getActiveViewOfType(MarkdownView);

	if (!view || !view.editor) return;

	const sourceEditor = view.editor;
	const targetEditor = event.target.cmView;
	const targetPos = event.target.cmView.editorView.state.doc.lineAt(
		event.target.cmView.posAtStart
	).to;

	const text = sourceEditor.getValue();
	const item = await findListItem(text, sourceLine);
	if (item) {
		const changes = [];
		const from = item.node.position.start.offset;
		const to = item.node.position.end.offset;
		changes.push({ from: from - 1, to });
		const textToInsert = text.slice(from, to);
		changes.push({ from: targetPos, insert: "\n" + textToInsert });
		console.log(changes);
		sourceEditor.cm.dispatch({ changes });
	}
}

export default class MyPlugin extends Plugin {
	async onload() {
		const that = this;
		this.registerEditorExtension(emptyLineGutter);
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
					processDrop(that.app, event);
				},
			})
		);
	}
}
