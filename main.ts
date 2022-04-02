import { Plugin, MarkdownView } from "obsidian";
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

function processDrop(app, event) {
	const sourceLineNum = parseInt(event.dataTransfer.getData("line"), 10);
	const targetLinePos = event.target.cmView.posAtStart;

	const view = app.workspace.getActiveViewOfType(MarkdownView);

	if (!view || !view.editor) return;

	const sourceEditor = view.editor;
	const targetEditor = event.target.cmView.editorView;

	// const sourceLine = sourceEditor.viewState.state.doc.lineAt(sourceLineNum);
	const targetLine =
		event.target.cmView.editorView.state.doc.lineAt(targetLinePos);

	const type = "move";
	const text = sourceEditor.getValue();
	const item = findListItem(text, sourceLineNum, "listItem");
	if (item) {
		const from = item.node.position.start.offset;
		const to = item.node.position.end.offset;
		let operations;

		if (type === "move") {
			const deleteOp = { from: from - 1, to };
			const computeIndent = (line) =>
				line.text.match(/^\t*/)[0].length + 1;

			const textToInsert = "\n" + text.slice(from, to);
			// const originalLineIndent = computeIndent(sourceLine);
			const firstLineIndent = computeIndent(targetLine);
			const textToInsertWithTabs = textToInsert.replace(
				/\n/g,
				"\n" + "\t".repeat(firstLineIndent)
			);
			const insertOp = {
				from: targetLine.to,
				insert: textToInsertWithTabs,
			};

			operations = { source: [deleteOp], target: [insertOp] };
		} else if (type === "embed") {
			const { id, changes } = getBlock(app, sourceLine - 1, view.file);
			const insertBlockOp = {
				from: targetLine.to,
				insert: ` ![[${view.file.basename}#^${id}]]`,
			};

			operations = { source: [changes], target: [insertBlockOp] };
		}

		const { source, target } = operations;
		console.log("ops:", operations);
		if (sourceEditor.cm == targetEditor)
			sourceEditor.cm.dispatch({ changes: [...source, ...target] });
		else {
			sourceEditor.cm.dispatch({ changes: source });
			targetEditor.dispatch({ changes: target });
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
