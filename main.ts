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
			: emptyMarker(view.state.doc.lineAt(line.from).number);
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
	const targetLine = event.target.cmView.editorView.state.doc.lineAt(
		event.target.cmView.posAtStart
	);

	// remove source item
	performOperation.performOperation(
		(root) => ({
			shouldUpdate: () => true,
			shouldStopPropagation: () => false,
			perform: () => {
				const sourceList = root.getListUnderLine(sourceLine);
				console.log(sourceLine);
				console.log(targetLine);
			},
		}),
		new MyEditor(sourceEditor),
		sourceEditor.getCursor()
	);
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
