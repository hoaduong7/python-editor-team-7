/**
 * A CoreMirror view extension providing structural highlighting using
 * CodeMirror's syntax tree.
 *
 * (c) 2021, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import { indentUnit, syntaxTree } from "@codemirror/language";
import { EditorState, Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

// Grammar is defined by https://github.com/lezer-parser/python/blob/master/src/python.grammar
class VisualBlock {
  constructor(
    readonly name: string,
    readonly left: number,
    readonly top: number,
    readonly height: number,
    readonly width: number
  ) {}

  draw() {
    const elt = document.createElement("div");
    elt.className = "cm-lshape";
    this.adjust(elt);
    return elt;
  }

  adjust(elt: HTMLElement) {
    elt.style.left = this.left + "px";
    elt.style.top = this.top + "px";
    elt.style.width = this.width + "px";
    elt.style.height = this.height + "px";
  }

  eq(other: VisualBlock) {
    return (
      this.left === other.left &&
      this.top === other.top &&
      this.height === other.height &&
      this.width === other.width
    );
  }
}

interface Measure {
  blocks: VisualBlock[];
}

const blocksView = ViewPlugin.fromClass(
  class {
    measureReq: { read: () => Measure; write: (value: Measure) => void };
    overlayLayer: HTMLElement;
    blocks: VisualBlock[] = [];

    constructor(readonly view: EditorView) {
      this.measureReq = {
        read: this.readBlocks.bind(this),
        write: this.drawBlocks.bind(this),
      };
      this.overlayLayer = view.scrollDOM.appendChild(
        document.createElement("div")
      );
      this.overlayLayer.className = "cm-lshapesLayer";
      this.overlayLayer.setAttribute("aria-hidden", "true");
      view.requestMeasure(this.measureReq);
    }

    update(update: ViewUpdate) {
      // We can probably limit this but we need to know when the language state has changed as parsing has occurred.
      this.view.requestMeasure(this.measureReq);
    }

    readBlocks(): Measure {
      const view = this.view;
      const { state } = view;
      const leftEdge =
        view.contentDOM.getBoundingClientRect().left -
        view.scrollDOM.getBoundingClientRect().left;
      const indentWidth =
        state.facet(indentUnit).length * view.defaultCharacterWidth;

      const blocks: VisualBlock[] = [];
      // We could throw away blocks if we tracked returning to the top-level or started from
      // the closest top-level node. Otherwise we need to render them because they overlap.
      // Should consider switching to tree cursors to avoid allocating syntax nodes.
      let depth = 0;
      const tree = syntaxTree(state);
      let body: { top: number; height: number; left: number } | undefined;
      if (tree) {
        tree.iterate({
          enter: (type, _start) => {
            if (type.name === "Body") {
              depth++;
            }
          },
          leave: (type, start, end) => {
            const isBodyParent = Boolean(body);
            const isBody = type.name === "Body";
            if (isBody) {
              // Skip past the colon starting the Body / block.
              // This needs to get smarter to deal with the single line version, e.g. `while True: pass`
              start = state.doc.lineAt(start).to + 1;

              const top = view.visualLineAt(start).top;
              const bottom = view.visualLineAt(
                // We also need to skip comments in a similar way, as they're extending our highlighting.
                skipTrailingBlankLines(state, end - 1)
              ).bottom;
              const height = bottom - top;
              const leftIndent = depth * indentWidth;
              const left = leftEdge + leftIndent;
              body = { left, height, top };

              depth--;
            } else if (isBodyParent) {
              const leftIndent = depth * indentWidth;
              const left = leftEdge + leftIndent;
              if (body) {
                blocks.push(
                  new VisualBlock(
                    type.name,
                    left,
                    body.top,
                    body.height,
                    body.left - left
                  )
                );
              }
              body = undefined;
            } else {
              body = undefined;
            }
          },
        });
      }
      return { blocks };
    }

    drawBlocks({ blocks }: Measure) {
      const blocksChanged =
        blocks.length !== this.blocks.length ||
        blocks.some((b, i) => !b.eq(this.blocks[i]));
      if (blocksChanged) {
        this.blocks = blocks;

        // Should be able to adjust old elements here if it's a performance win.
        this.overlayLayer.textContent = "";
        for (const b of blocks) {
          this.overlayLayer.appendChild(b.draw());
        }
      }
    }

    destroy() {
      this.overlayLayer.remove();
    }
  }
);

const skipTrailingBlankLines = (state: EditorState, position: number) => {
  let line = state.doc.lineAt(position);
  while ((line.length === 0 || /^\s+$/.test(line.text)) && line.number >= 1) {
    line = state.doc.line(line.number - 1);
  }
  return line.to;
};

const baseTheme = EditorView.baseTheme({
  ".cm-lshapesLayer": {
    position: "absolute",
    top: 0,
    height: "100%",
    width: "100%",
    zIndex: -1,
  },
  ".cm-lshape": {
    display: "block",
    position: "absolute",
    borderRight: "2px solid var(--chakra-colors-blimpTeal-100)",
    borderTop: "2px solid var(--chakra-colors-blimpTeal-100)",
  },
});

export const lShapes = (): Extension => [blocksView, baseTheme];