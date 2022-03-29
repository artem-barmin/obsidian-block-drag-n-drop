import { Plugin, MarkdownView } from "obsidian";
import { gutter, GutterMarker } from "@codemirror/gutter";
import { EditorView } from "@codemirror/view";
import { LoggerService } from "obsidian-outliner/src/services/LoggerService";
import { ParserService } from "obsidian-outliner/src/services/ParserService";
import { ApplyChangesService } from "obsidian-outliner/src/services/ApplyChangesService";
import { PerformOperationService } from "obsidian-outliner/src/services/PerformOperationService";
import { MyEditor } from "obsidian-outliner/src/MyEditor";

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
			: emptyMarker(view.state.doc.lineAt(line.from).number - 1);
	},
});

function processDrop(app, event, performOperation) {
	const sourceLine = event.dataTransfer.getData("line");

	const view = app.workspace.getActiveViewOfType(MarkdownView);

	if (!view || !view.editor) return;

	const sourceEditor = view.editor;
	const targetEditor = Object.create(sourceEditor.__proto__, {
		cm: {
			value: event.target.cmView.editorView,
			writable: true,
			configurable: true,
		},
	});
	const targetLine =
		event.target.cmView.editorView.state.doc.lineAt(
			event.target.cmView.posAtStart
		).number - 1;

	const operation = (editor, cb) =>
		performOperation.performOperation(
			(root) => ({
				shouldUpdate: () => true,
				shouldStopPropagation: () => false,
				perform: () => cb(root),
			}),
			new MyEditor(editor),
			{ line: 0, ch: 0 }
		);

	if (sourceEditor.cm === targetEditor.cm) {
		operation(targetEditor, (root) => {
			const sourceItem = root.getListUnderLine(sourceLine);
			const targetItem = root.getListUnderLine(targetLine);

			const sourceParent = sourceItem.getParent();
			sourceParent.removeChild(sourceItem);

			targetItem.addBeforeAll(sourceItem);
		});
	} else {
		let sourceItem;
		operation(sourceEditor, (root) => {
			sourceItem = root.getListUnderLine(sourceLine);
			const sourceParent = sourceItem.getParent();
			sourceParent.removeChild(sourceItem);
		});

		operation(targetEditor, (root) => {
			const targetItem = root.getListUnderLine(targetLine);
			targetItem.addBeforeAll(sourceItem);
		});
	}
}

export default class MyPlugin extends Plugin {
	async onload() {
		this.logger = new LoggerService({});

		this.parser = new ParserService(this.logger);
		this.applyChanges = new ApplyChangesService();
		const performOperation = new PerformOperationService(
			this.parser,
			this.applyChanges
		);
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
					processDrop(that.app, event, performOperation);
				},
			})
		);
	}
}
