// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 DigiGate

/*---------------------------------------------------------------------------------------------
 *  Unit tests for the tab model (src/renderer/tabs/model.ts).
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { TabsModel, type TabsChange } from '../../src/renderer/tabs/model';

const paths = (model: TabsModel) => model.tabs.map(tab => tab.path);

function withTabs(...files: string[]): TabsModel {
	const model = new TabsModel();
	for (const file of files) {
		model.open(file);
	}
	return model;
}

describe('opening', () => {
	it('activates a newly opened tab and pins it by default', () => {
		const model = new TabsModel();
		const tab = model.open('/a.md');
		expect(model.active).toBe(tab);
		expect(tab.preview).toBe(false);
		expect(tab.viewerId).toBe('markdown');
	});

	it('inserts to the right of the active tab, not at the end', () => {
		const model = withTabs('/a.md', '/b.md', '/c.md');
		model.activate(model.find('/a.md')!.id);
		model.open('/d.md');
		expect(paths(model)).toEqual(['/a.md', '/d.md', '/b.md', '/c.md']);
	});

	it('never opens the same file twice, whatever the separator or case', () => {
		const model = withTabs('C:/docs/a.md', '/b.md');
		const again = model.open('c:\\Docs\\A.md');
		expect(model.tabs).toHaveLength(2);
		expect(model.active).toBe(again);
		expect(again.path).toBe('C:/docs/a.md');
	});

	it('ids are never reused', () => {
		const model = withTabs('/a.md');
		const first = model.active!.id;
		model.closeAll();
		expect(model.open('/a.md').id).not.toBe(first);
	});
});

describe('preview tabs', () => {
	it('a preview replaces the existing preview in place', () => {
		const model = withTabs('/a.md', '/c.md');
		model.activate(model.find('/a.md')!.id);
		model.open('/b.md', { mode: 'preview' });
		model.open('/x.md', { mode: 'preview' });
		expect(paths(model)).toEqual(['/a.md', '/x.md', '/c.md']);
		expect(model.active?.path).toBe('/x.md');
		expect(model.active?.preview).toBe(true);
	});

	it('replaces the preview even when it is not the active tab', () => {
		const model = new TabsModel();
		model.open('/p.md', { mode: 'preview' });
		model.open('/a.md');
		model.open('/q.md', { mode: 'preview' });
		expect(paths(model)).toEqual(['/q.md', '/a.md']);
	});

	it('a pinned tab is joined, not replaced', () => {
		const model = new TabsModel();
		const first = model.open('/a.md', { mode: 'preview' });
		model.pin(first.id);
		model.open('/b.md', { mode: 'preview' });
		expect(paths(model)).toEqual(['/a.md', '/b.md']);
	});

	it('opening a preview tab deliberately pins it', () => {
		const model = new TabsModel();
		model.open('/a.md', { mode: 'preview' });
		expect(model.open('/a.md').preview).toBe(false);
	});

	it('opening a pinned tab as a preview leaves it pinned', () => {
		const model = withTabs('/a.md');
		expect(model.open('/a.md', { mode: 'preview' }).preview).toBe(false);
	});
});

describe('background tabs', () => {
	it('opens without activating, and is next in line for Ctrl+Tab', () => {
		const model = withTabs('/a.md', '/b.md');
		model.open('/bg.md', { background: true });
		expect(model.active?.path).toBe('/b.md');
		expect(model.recent.map(tab => tab.path)).toEqual(['/b.md', '/bg.md', '/a.md']);
	});

	it('activates anyway when nothing is active', () => {
		const model = new TabsModel();
		model.open('/a.md', { background: true });
		expect(model.active?.path).toBe('/a.md');
	});
});

describe('activation', () => {
	it('moves by position and wraps', () => {
		const model = withTabs('/a.md', '/b.md', '/c.md');
		model.activateRelative(1);
		expect(model.active?.path).toBe('/a.md');
		model.activateRelative(-1);
		expect(model.active?.path).toBe('/c.md');
	});

	it('Ctrl+9 is always the last tab', () => {
		const model = withTabs('/a.md', '/b.md', '/c.md');
		model.activateIndex(0);
		expect(model.active?.path).toBe('/a.md');
		model.activateIndex(8);
		expect(model.active?.path).toBe('/c.md');
		model.activateIndex(5);
		expect(model.active?.path).toBe('/c.md');
	});
});

describe('closing', () => {
	it('falls back to the tab used before, not the neighbour', () => {
		const model = withTabs('/a.md', '/b.md', '/c.md');
		model.activate(model.find('/a.md')!.id);
		model.activate(model.find('/c.md')!.id);
		model.close(model.find('/c.md')!.id);
		expect(model.active?.path).toBe('/a.md');
	});

	it('closing a background tab leaves the active one alone', () => {
		const model = withTabs('/a.md', '/b.md');
		model.close(model.find('/a.md')!.id);
		expect(model.active?.path).toBe('/b.md');
	});

	it('closing the last tab leaves nothing active', () => {
		const model = withTabs('/a.md');
		model.close(model.active!.id);
		expect(model.active).toBeUndefined();
		expect(model.tabs).toHaveLength(0);
	});

	it('closes the others and those to the right', () => {
		const model = withTabs('/a.md', '/b.md', '/c.md', '/d.md');
		model.closeToTheRight(model.find('/b.md')!.id);
		expect(paths(model)).toEqual(['/a.md', '/b.md']);
		model.closeOthers(model.find('/a.md')!.id);
		expect(paths(model)).toEqual(['/a.md']);
		expect(model.active?.path).toBe('/a.md');
	});
});

describe('reopening closed tabs', () => {
	it('brings a tab back where it was, with its view state', () => {
		const model = withTabs('/a.md', '/b.md', '/c.md');
		const b = model.find('/b.md')!;
		model.setViewState(b.id, { scrollTop: 120 });
		model.close(b.id);
		const reopened = model.reopenClosed()!;
		expect(paths(model)).toEqual(['/a.md', '/b.md', '/c.md']);
		expect(reopened.viewState).toEqual({ scrollTop: 120 });
		expect(model.active).toBe(reopened);
	});

	it('restores a batch close to its original order', () => {
		const model = withTabs('/a.md', '/b.md', '/c.md');
		model.closeOthers(model.find('/a.md')!.id);
		model.reopenClosed();
		model.reopenClosed();
		expect(paths(model)).toEqual(['/a.md', '/b.md', '/c.md']);
	});

	it('skips a file that has been opened again since', () => {
		const model = withTabs('/a.md', '/b.md');
		model.close(model.find('/a.md')!.id);
		model.close(model.find('/b.md')!.id);
		model.open('/b.md');
		expect(model.reopenClosed()?.path).toBe('/a.md');
		expect(model.canReopenClosed).toBe(false);
		expect(model.reopenClosed()).toBeUndefined();
	});
});

describe('change events', () => {
	it('says whether the active tab changed', () => {
		const model = withTabs('/a.md', '/b.md');
		const changes: TabsChange[] = [];
		model.onChange(change => changes.push(change));

		model.open('/bg.md', { background: true });
		model.activate(model.find('/a.md')!.id);
		model.move(model.find('/a.md')!.id, 2);

		expect(changes.map(change => change.activeChanged)).toEqual([false, true, false]);
	});

	it('storing view state is not a change', () => {
		const model = withTabs('/a.md');
		let count = 0;
		model.onChange(() => count++);
		model.setViewState(model.active!.id, { scrollTop: 5 });
		expect(count).toBe(0);
		expect(model.active?.viewState).toEqual({ scrollTop: 5 });
	});
});

describe('moving', () => {
	it('moves a tab to an index, clamped to the strip', () => {
		const model = withTabs('/a.md', '/b.md', '/c.md');
		model.move(model.find('/a.md')!.id, 99);
		expect(paths(model)).toEqual(['/b.md', '/c.md', '/a.md']);
		model.move(model.find('/a.md')!.id, 0);
		expect(paths(model)).toEqual(['/a.md', '/b.md', '/c.md']);
	});
});

describe('persistence', () => {
	it('round-trips order, the active tab, preview and view state', () => {
		const model = withTabs('/a.md', '/b.md');
		model.open('/p.md', { mode: 'preview' });
		model.setViewState(model.find('/a.md')!.id, { scrollTop: 40 });
		model.activate(model.find('/b.md')!.id);

		const restored = TabsModel.restore(JSON.parse(JSON.stringify(model.serialize())));
		expect(paths(restored)).toEqual(['/a.md', '/b.md', '/p.md']);
		expect(restored.active?.path).toBe('/b.md');
		expect(restored.find('/p.md')?.preview).toBe(true);
		expect(restored.find('/a.md')?.viewState).toEqual({ scrollTop: 40 });
	});

	it('drops what the host says no longer exists, and falls back to the first tab', () => {
		const model = withTabs('/a.md', '/gone.md');
		const restored = TabsModel.restore(model.serialize(), path => path !== '/gone.md');
		expect(paths(restored)).toEqual(['/a.md']);
		expect(restored.active?.path).toBe('/a.md');
	});

	it('survives anything that is not what it wrote', () => {
		for (const junk of [undefined, null, 42, 'x', [], {}, { version: 2, tabs: [] }, { version: 1, tabs: 'x' }]) {
			const restored = TabsModel.restore(junk);
			expect(restored.tabs).toHaveLength(0);
			expect(restored.active).toBeUndefined();
		}
	});

	it('keeps the usable entries of a damaged file', () => {
		const restored = TabsModel.restore({
			version: 1,
			active: 7,
			tabs: [
				{ path: '/a.md', viewerId: 'markdown', preview: true },
				null,
				{ path: '' },
				{ path: 3 },
				{ path: '/A.md' },
				{ path: '/b.md', viewerId: 5, preview: true },
			],
		});
		expect(paths(restored)).toEqual(['/a.md', '/b.md']);
		expect(restored.find('/b.md')?.viewerId).toBe('markdown');
		// One preview tab at most.
		expect(restored.tabs.filter(tab => tab.preview)).toHaveLength(1);
		expect(restored.active?.path).toBe('/a.md');
	});
});
