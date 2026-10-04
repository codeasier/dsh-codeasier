import type { Context } from '@deepseek-ai/cordis';
import type { TuiPluginHost } from '@deepseek-harness-tui/dsh-tui/plugin-host';
import type { TuiStatusRuntime, TuiStatusViewProps } from '@deepseek-harness-tui/dsh-tui/extensions';
import type { TuiSceneRuntime, TuiSceneProps } from '@deepseek-harness-tui/dsh-tui/scenes';
import type { CrossReviewService } from './service.js';
import type { ReviewReport } from './records.js';
import { createReviewCommand } from './host.js';
import { freezeRecursively } from './protocol.js';

export const name = 'cross-review-tui';
export const inject = ['crossReview'];
export const TUI_COMMAND_ID = 'cross-review-control';
export const TUI_STATUS_KEY = 'cross-review:progress';
export const TUI_SCENE_ID = 'cross-review-report';
export interface TuiAdapterCapabilities {
  command: boolean;
  progress: 'view' | 'text' | 'none';
  scene: boolean;
  issues: string[];
}
export interface TuiAdapterHandle { readonly capabilities: TuiAdapterCapabilities; dispose(): void }
export interface TuiAdapterDiagnostic { readonly activationUid: number | null; readonly capabilities: TuiAdapterCapabilities }
/** Read-only observation from the actual adapter activation, never an authorization receipt. */
export const TUI_ADAPTER_DIAGNOSTIC = 'cross-review/tui-capabilities';
declare module '@deepseek-ai/cordis' {
  interface Events { 'cross-review/tui-capabilities'(diagnostic: TuiAdapterDiagnostic): void }
}

function safeText(value: string): string { return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ''); }
interface ViewState { readonly report?: ReviewReport; readonly progress: string; readonly latestRevision?: number }

/** Optional public seams only. No React/TUI runtime dependency enters the Host. */
export function mountTuiAdapter(ctx: Context): TuiAdapterHandle {
  const capabilities: TuiAdapterCapabilities = { command: false, progress: 'none', scene: false, issues: [] };
  const host: TuiPluginHost | undefined = ctx.get('tuiPluginHost', false);
  const status: TuiStatusRuntime | undefined = ctx.get('tuiStatus', false);
  const scenes: TuiSceneRuntime | undefined = ctx.get('tuiScenes', false);
  const disposers: (() => void)[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const failures: unknown[] = [];
    for (const stop of disposers.reverse()) { try { stop(); } catch (error) { failures.push(error); } }
    listeners.clear();
    if (failures.length) throw new AggregateError(failures, 'Optional TUI adapter disposal failed');
  };
  const listeners = new Set<() => void>();
  if (!host && !status && !scenes) return { capabilities, dispose };
  const service: CrossReviewService | undefined = ctx.get('crossReview', false);
  if (!service) throw new Error('Optional TUI adapter requires the shared crossReview service');
  let state: ViewState = Object.freeze({ progress: 'Cross-review: /review report <runId> selects an owner-authorized report' });
  const getSnapshot = () => state;
  const subscribe = (listener: () => void) => { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; };
  let scalarDisposer: (() => void) | undefined;
  const update = (next: ViewState) => {
    if (disposed) return;
    state = Object.freeze(next);
    if (capabilities.progress === 'text' && status) {
      scalarDisposer?.(); scalarDisposer = undefined;
      try { scalarDisposer = status.set(TUI_STATUS_KEY, safeText(state.progress), ctx); }
      catch { capabilities.progress = 'none'; capabilities.issues.push('Scalar progress contribution was refused'); }
    }
    for (const listener of listeners) { try { listener(); } catch { /* UI observer cannot affect backend state */ } }
  };
  const Progress = ({ React, ui }: TuiStatusViewProps) => {
    const view = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return React.createElement(ui.Text, null, safeText(view.progress));
  };
  const Report = ({ React, ui, close }: TuiSceneProps) => {
    const view = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const report = view.report;
    const stale = report && view.latestRevision !== undefined && view.latestRevision > report.revision;
    const text = report ? JSON.stringify(report, null, 2) : capabilities.command
      ? 'No owner-authorized report selected. Use /review report <runId>.'
      : 'Mediated /review is unavailable. Ask the owning Agent to use native cross_review_report/control tools.';
    return React.createElement(ui.Box, { flexDirection: 'column', height: '100%' },
      React.createElement(ui.Box, { onClick: () => close() }, React.createElement(ui.Text, null, 'Cross-review report [Close]')),
      stale ? React.createElement(ui.Text, null, `Report revision ${report.revision} is immutable; refresh with /review report ${report.runId}`) : null,
      React.createElement(ui.ScrollBox, { flexGrow: 1 }, React.createElement(ui.Text, null, safeText(text))));
  };
  try {
    if (typeof scenes?.register === 'function' && typeof scenes.open === 'function') {
      const stop = scenes.register({ id: TUI_SCENE_ID, title: 'Cross-review report', component: Report }, ctx);
      if (typeof stop === 'function') { disposers.push(stop); capabilities.scene = true; }
    }
  } catch { capabilities.issues.push('Report scene registration was refused'); }
  try {
    if (typeof status?.registerView === 'function') {
      const stop = status.registerView({ key: TUI_STATUS_KEY, maxRows: 2, component: Progress }, ctx);
      if (typeof stop === 'function') { disposers.push(stop); capabilities.progress = 'view'; }
      else capabilities.issues.push('Rich progress contribution was refused');
    }
  } catch { capabilities.issues.push('Rich progress registration was refused'); }
  if (capabilities.progress === 'none' && typeof status?.set === 'function') {
    try { scalarDisposer = status.set(TUI_STATUS_KEY, state.progress, ctx); capabilities.progress = 'text'; }
    catch { capabilities.issues.push('Scalar progress registration was refused'); }
  }
  disposers.push(() => { scalarDisposer?.(); scalarDisposer = undefined; });
  try {
    if (host && typeof host.hostDescriptor === 'function' && typeof host.registerCommand === 'function') {
      const contract = host.hostDescriptor().contracts.some(value => value.apiVersion === 'commands.dsh/v1alpha1' && value.kind === 'Command');
      if (!contract) capabilities.issues.push('Mediated Command contract is unavailable');
      else if (!host.grants.allows(ctx, 'commands.invoke', TUI_COMMAND_ID)) capabilities.issues.push('Review command permission was denied');
      else {
        const command = createReviewCommand(service, report => {
          if (disposed) return;
          const selected = freezeRecursively(structuredClone(report));
          update({ report: selected, latestRevision: selected.revision,
            progress: `Cross-review ${selected.runId}: ${selected.state}; verified ${selected.findings.length}, pending ${selected.pending.length}; revision ${selected.revision}` });
          if (capabilities.scene) {
            try { if (!scenes!.open(TUI_SCENE_ID)) capabilities.issues.push('Report scene is unavailable'); }
            catch { capabilities.issues.push('Report scene opening was refused'); }
          }
        });
        const stop = host.registerCommand(ctx, TUI_COMMAND_ID, command);
        if (typeof stop === 'function') { disposers.push(stop); capabilities.command = true; }
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? safeText(error.message).slice(0, 500) : 'Unknown public host refusal';
    capabilities.issues.push(`Mediated review command registration was refused: ${reason}`);
  }
  if (!capabilities.command) update({ progress: 'Cross-review: native cross_review_report/control tools; /review unavailable' });
  // This is a read-only event feed, not a scheduler. Never expose another owner:
  // only a receipt already authorized by service.report selects an observed run.
  if (capabilities.progress !== 'none' || capabilities.scene) {
    try {
      disposers.push(service.subscribe(record => {
        if (!state.report || record.id !== state.report.runId || record.revision <= (state.latestRevision ?? -1)) return;
        update({ report: state.report, latestRevision: record.revision,
          progress: `Cross-review ${record.id}: ${record.state}; reviewer results ${record.attempts.filter(attempt => attempt.kind === 'reviewer' && attempt.state === 'completed').length}/${record.config.reviewers.length}; revision ${record.revision}` });
      }));
    } catch { capabilities.issues.push('Shared service progress subscription is unavailable'); }
  }
  return { capabilities, dispose };
}

/** Cordis owns the returned disposer; optional adapter unload never disposes runs. */
export async function apply(ctx: Context): Promise<() => void> {
  const handle = mountTuiAdapter(ctx);
  if (typeof ctx.emit === 'function') {
    try { ctx.emit(TUI_ADAPTER_DIAGNOSTIC, freezeRecursively({ activationUid: ctx.fiber.uid, capabilities: structuredClone(handle.capabilities) })); }
    catch { /* Diagnostic observers cannot alter registration or owned disposal. */ }
  }
  return handle.dispose;
}
