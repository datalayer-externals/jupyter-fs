/******************************************************************************
 *
 * Copyright (c) 2019, the jupyter-fs authors.
 *
 * This file is part of the jupyter-fs library, distributed under the terms of
 * the Apache License 2.0.  The full license can be found in the LICENSE file.
 *
 */

import { JupyterFrontEnd } from "@jupyterlab/application";
import {
  closeIcon,
  copyIcon,
  cutIcon,
  downloadIcon,
  editIcon,
  filterListIcon,
  pasteIcon,
  refreshIcon,
  newFolderIcon,
} from "@jupyterlab/ui-components";
import { DisposableSet, IDisposable } from "@lumino/disposable";
import { Menu } from "@lumino/widgets";
import { Content, Path } from "tree-finder";


import { JupyterClipboard } from "./clipboard";
import { TreeFinderSidebar } from "./treefinder";
import type { IFSResource } from "./filesystem";
import type { ContentsProxy, TreeFinderTracker } from "./treefinder";
import { getContentParent, getRefreshTargets, revealAndSelectPath } from "./contents_utils";
import { ISettingRegistry } from "@jupyterlab/settingregistry";

// define the command ids as a constant tuple
export const commandNames = [
  "copy",
  "cut",
  "delete",
  "open",
  "paste",
  "refresh",
  "rename",
  "download",
  "create_folder",
  // "create_file",
  // "navigate",
  "copyFullPath",
  "copyRelativePath",
  "toggleColumnPath",
  "toggleColumn",
] as const;


export const commandIDs = Object.fromEntries(commandNames.map(
  name => [name, `treefinder:${name}`]
)) as CommandIDs;
export type CommandIDs = {[k in typeof commandNames[number]]: string};


const COLUMN_NAMES = [
  "size",
  "last_modified",
  "writable",
  "mimetype",
];


export function idFromResource(resource: IFSResource): string {
  return [resource.name.split(" ").join(""), resource.drive].join("_");
}


const currentWidgetSelectionIsWritable = (tracker: TreeFinderTracker): boolean => {
  if (!tracker.currentWidget) {
    return false;
  }
  const selection = tracker.currentWidget.treefinder.model?.selection;
  if (selection) {
    return selection.every((x: Content<ContentsProxy.IJupyterContentRow>) => x.row.writable);
  }
  return false;
};

function toggleColumnCommandId(column: string): string {
  return `${commandIDs.toggleColumn}-${column}`;
}


function _getRelativePaths(selectedFiles: Array<Content<ContentsProxy.IJupyterContentRow>>): string[] {
  const allPaths: string[] = [];
  for (const file of selectedFiles) {
    const relativePath = file.getPathAtDepth(1).join("/");
    allPaths.push(relativePath);
  }
  return allPaths;
}


export function createCommands(
  app: JupyterFrontEnd,
  tracker: TreeFinderTracker,
  clipboard: JupyterClipboard,
  resources: IFSResource[],
  settings?: ISettingRegistry.ISettings,
): IDisposable {
  const selector = ".jp-tree-finder-sidebar";
  const submenu = new Menu({ commands: app.commands });
  submenu.title.label = "Show/Hide Columns";
  submenu.title.icon = filterListIcon;
  submenu.addItem({ command: commandIDs.toggleColumnPath });
  for (const column of COLUMN_NAMES) {
    submenu.addItem({ command: toggleColumnCommandId(column) });
  }

  // const toggleState: {[key: string]: {[key: string]: boolean}} = {};
  // for (let resource of resources) {
  //   const colsToDisplay = resource.displayColumns as string[] ?? ['size'];
  //   const id = idFromResource(resource);
  //   toggleState[id] = {};
  //   const state = toggleState[id];
  //   for (let key of COLUMN_NAMES) {
  //     state[key] = colsToDisplay.includes(key);
  //   }
  // }
  const toggleState: {[key: string]: boolean} = {};
  const colsToDisplay = settings?.composite.display_columns as string[] ?? ["size"];
  for (const key of COLUMN_NAMES) {
    toggleState[key] = colsToDisplay.includes(key);
  }

  let contextMenuRank = 1;

  // globally accessible jupyter commands[
  return [
    app.commands.addCommand(commandIDs.copy, {
      execute: args => clipboard.model.copySelection(tracker.currentWidget!.treefinder.model!),
      icon: copyIcon,
      label: "Copy",
      isVisible: () => {
        const widget = tracker.currentWidget;
        if (!widget) {
          return false;
        }
        // Copy of folders are unsupported
        if (widget.treefinder.model?.selection.some(v => v.row.kind === "dir")) {
          return false;
        }
        return true;
      },
      isEnabled: () => !!tracker.currentWidget,
    }),
    app.commands.addCommand(commandIDs.cut, {
      execute: args => clipboard.model.cutSelection(tracker.currentWidget!.treefinder.model!),
      icon: cutIcon,
      label: "Cut",
      isEnabled: () => currentWidgetSelectionIsWritable(tracker),
    }),
    app.commands.addCommand(commandIDs.delete, {
      execute: args => clipboard.model.deleteSelection(tracker.currentWidget!.treefinder.model!),
      icon: closeIcon.bindprops({ stylesheet: "menuItem" }),
      label: "Delete",
      isEnabled: () => currentWidgetSelectionIsWritable(tracker),
    }),
    app.commands.addCommand(commandIDs.open, {
      execute: args => tracker.currentWidget!.treefinder.model!.openSub.next(tracker.currentWidget!.treefinder.selection?.map(c => c.row)),
      label: "Open",
      isEnabled: () => !!tracker.currentWidget,
    }),
    app.commands.addCommand(commandIDs.paste, {
      execute: args => clipboard.model.pasteSelection(tracker.currentWidget!.treefinder.model!),
      icon: pasteIcon,
      label: "Paste",
      isEnabled: () => !!tracker.currentWidget,
    }),
    app.commands.addCommand(commandIDs.rename, {
      execute: args => {
        const widget = tracker.currentWidget!;
        const oldContent = widget.treefinder.selection![0];
        void TreeFinderSidebar.doRename(widget, oldContent).then(newContent => {
          widget.treefinder.model?.renamerSub.next( { name: newContent.name, target: oldContent } );
          // TODO: Model state of TreeFinderWidget should be updated by renamerSub process.
          oldContent.row = newContent;
        });
      },
      icon: editIcon,
      label: "Rename",
      isEnabled: () => currentWidgetSelectionIsWritable(tracker),
    }),
    app.commands.addCommand(commandIDs.download, {
      execute: async args => {
        const widget = tracker.currentWidget!;
        const selection = widget.treefinder.selection!;
        await Promise.allSettled(selection.map(s => widget.download(s.pathstr, s.hasChildren)));
      },
      icon: downloadIcon,
      label: "Download",
      isEnabled: () => !!(tracker.currentWidget?.treefinder.model?.selection),
    }),
    app.commands.addCommand(commandIDs.create_folder, {
      execute: async args =>  {
        const widget = tracker.currentWidget!;
        const model = widget.treefinder.model!;
        let target = model.selectedLast ?? model.root;
        if (!target.hasChildren) {
          target = await getContentParent(target, model.root);
        }
        const path = Path.fromarray(target.row.path);
        const row = await widget.treefinder.contentsProxy.newUntitled({
          type: "directory",
          path,
        });
        target.invalidate();
        const content = await revealAndSelectPath(model, row.path);
        // Is this really needed?
        model.refreshSub.next(getRefreshTargets([target.row], model.root));
        // Scroll into view if not visible
        await TreeFinderSidebar.scrollIntoView(widget.treefinder, content.pathstr);
        const newContent = await TreeFinderSidebar.doRename(widget, content);
        model.renamerSub.next( { name: newContent.name, target: content } );
        // TODO: Model state of TreeFinderWidget should be updated by renamerSub process.
        content.row = newContent;
      },
      icon: newFolderIcon,
      label: "New Folder",
      isEnabled: () => !!tracker.currentWidget,
    }),
    app.commands.addCommand(commandIDs.refresh, {
      execute: args => {
        if (args["selection"]) {
          clipboard.refreshSelection(tracker.currentWidget!.treefinder.model!);
        } else {
          clipboard.refresh(tracker.currentWidget!.treefinder.model);
        }
      },
      icon: refreshIcon,
      label: args => args["selection"] ? "Refresh Selection" : "Refresh",
      isEnabled: () => !!tracker.currentWidget,
    }),
    app.commands.addCommand(commandIDs.copyFullPath, {
      execute: async args => {
        const widget = tracker.currentWidget!;
        const trimEnd = (path: string): string => path.trimEnd().replace(/\/+$/, "");
        const fullPaths = _getRelativePaths(widget.treefinder.selection!).map(relativePath => [trimEnd(widget.url ?? ""), relativePath].join("/"));
        await navigator.clipboard.writeText(fullPaths.join("\n"));
      },
      label: "Copy Full Path",
      isEnabled: () => !!tracker.currentWidget,
    }),
    app.commands.addCommand(commandIDs.copyRelativePath, {
      execute: async args => {
        const widget = tracker.currentWidget!;
        const relativePaths = _getRelativePaths(widget.treefinder.selection!);
        await navigator.clipboard.writeText(relativePaths.join("\n"));
      },
      label: "Copy Relative Path",
      isEnabled: () => !!tracker.currentWidget,
    }),

    app.commands.addCommand(commandIDs.toggleColumnPath, {
      execute: args => { /* no-op */ },
      label: "path",
      isEnabled: () => false,
      isToggled: () => true,
    }),
    ...COLUMN_NAMES.map((column: keyof ContentsProxy.IJupyterContentRow) => app.commands.addCommand(toggleColumnCommandId(column), {
      execute: async args => {
        toggleState[column] = !toggleState[column];
        await settings?.set("display_columns", COLUMN_NAMES.filter(k => toggleState[k]));
      },
      label: column,
      isToggleable: true,
      isToggled: () => toggleState[column],
    })),

    // context menu items
    app.contextMenu.addItem({
      command: commandIDs.open,
      selector,
      rank: contextMenuRank++,
    }),

    app.contextMenu.addItem({
      command: commandIDs.copy,
      selector,
      rank: contextMenuRank++,
    }),
    app.contextMenu.addItem({
      command: commandIDs.cut,
      selector,
      rank: contextMenuRank++,
    }),
    app.contextMenu.addItem({
      command: commandIDs.paste,
      selector,
      rank: contextMenuRank++,
    }),
    app.contextMenu.addItem({
      command: commandIDs.delete,
      selector,
      rank: contextMenuRank++,
    }),
    app.contextMenu.addItem({
      command: commandIDs.rename,
      selector,
      rank: contextMenuRank++,
    }),
    app.contextMenu.addItem({
      command: commandIDs.download,
      selector,
      rank: contextMenuRank++,
    }),
    app.contextMenu.addItem({
      type: "separator",
      selector,
      rank: contextMenuRank++,
    }),
    app.contextMenu.addItem({
      command: commandIDs.copyFullPath,
      selector,
      rank: contextMenuRank++,
    }),
    app.contextMenu.addItem({
      command: commandIDs.copyRelativePath,
      selector,
      rank: contextMenuRank++,
    }),
    app.contextMenu.addItem({
      type: "separator",
      selector,
      rank: contextMenuRank++,
    }),
    app.contextMenu.addItem({
      type: "submenu",
      submenu,
      selector,
      rank: contextMenuRank++,
    }),
    app.contextMenu.addItem({
      args: { selection: true },
      command: commandIDs.refresh,
      selector,
      rank: contextMenuRank++,
    }),
  ].reduce((set: DisposableSet, d) => {
    set.add(d); return set;
  }, new DisposableSet());
}
