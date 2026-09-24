import { NODE_DEFAULTS } from '@/theme';
import { assignSmartHandlesWithOptions, getSmartRoutingOptionsFromViewSettings } from '@/services/smartEdgeRouting';
import type { SetFlowState } from '../actionFactory';
import { syncTabNodesEdges } from './syncTabNodesEdges';
import type { FlowState } from '../types';

export function createViewActions(set: SetFlowState): Pick<
    FlowState,
    | 'toggleGrid'
    | 'toggleSnap'
    | 'setShortcutsHelpOpen'
    | 'setViewSettings'
    | 'setGlobalEdgeOptions'
    | 'setDefaultIconsEnabled'
    | 'setSmartRoutingEnabled'
    | 'setSmartRoutingProfile'
    | 'setSmartRoutingBundlingEnabled'
    | 'setLargeGraphSafetyMode'
    | 'setLargeGraphSafetyProfile'
> {
    return {
        toggleGrid: () => set((state) => ({
            viewSettings: { ...state.viewSettings, showGrid: !state.viewSettings.showGrid },
        })),

        toggleSnap: () => set((state) => ({
            viewSettings: { ...state.viewSettings, snapToGrid: !state.viewSettings.snapToGrid },
        })),

        setShortcutsHelpOpen: (open) => set((state) => ({
            viewSettings: { ...state.viewSettings, isShortcutsHelpOpen: open },
        })),

        setViewSettings: (settings) => set((state) => ({
            viewSettings: { ...state.viewSettings, ...settings },
        })),

        setGlobalEdgeOptions: (options) => set((state) => {
            const newOptions = { ...state.globalEdgeOptions, ...options };
            const restylesLines = options.type !== undefined || options.curve !== undefined;

            const updatedEdges = state.edges.map((edge) => ({
                ...edge,
                type: newOptions.type === 'default' ? undefined : newOptions.type,
                animated: newOptions.animated,
                style: {
                    ...edge.style,
                    strokeWidth: newOptions.strokeWidth,
                    ...(newOptions.color ? { stroke: newOptions.color } : {}),
                },
                // A per-edge curve outranks the diagram-wide one, so a new diagram-wide line
                // style drops it; otherwise edges restyled one by one would keep their old shape.
                ...(restylesLines && edge.data?.curve !== undefined
                    ? { data: { ...edge.data, curve: undefined } }
                    : {}),
            }));

            return {
                globalEdgeOptions: newOptions,
                edges: updatedEdges,
                tabs: syncTabNodesEdges(state.tabs, state.activeTabId, state.nodes, updatedEdges),
            };
        }),

        setDefaultIconsEnabled: (enabled) => set((state) => {
            const newViewSettings = { ...state.viewSettings, defaultIconsEnabled: enabled };

            const updatedNodes = state.nodes.map((node) => {
                const defaultIcon = NODE_DEFAULTS[node.type || 'process']?.icon;

                if (enabled) {
                    if (!node.data.icon && !node.data.customIconUrl) {
                        return { ...node, data: { ...node.data, icon: defaultIcon } };
                    }
                } else if (node.data.icon === defaultIcon) {
                    return { ...node, data: { ...node.data, icon: undefined } };
                }

                return node;
            });

            return {
                viewSettings: newViewSettings,
                nodes: updatedNodes,
            };
        }),

        setSmartRoutingEnabled: (enabled) => set((state) => {
            let newEdges = state.edges;
            if (enabled) {
                newEdges = assignSmartHandlesWithOptions(
                    state.nodes,
                    state.edges,
                    getSmartRoutingOptionsFromViewSettings(state.viewSettings)
                );
            }

            return {
                viewSettings: { ...state.viewSettings, smartRoutingEnabled: enabled },
                edges: newEdges,
            };
        }),

        setSmartRoutingProfile: (profile) => set((state) => {
            const nextViewSettings = { ...state.viewSettings, smartRoutingProfile: profile };
            const nextEdges = state.viewSettings.smartRoutingEnabled
                ? assignSmartHandlesWithOptions(
                    state.nodes,
                    state.edges,
                    getSmartRoutingOptionsFromViewSettings(nextViewSettings)
                )
                : state.edges;
            return {
                viewSettings: nextViewSettings,
                edges: nextEdges,
            };
        }),

        setSmartRoutingBundlingEnabled: (enabled) => set((state) => {
            const nextViewSettings = { ...state.viewSettings, smartRoutingBundlingEnabled: enabled };
            const nextEdges = state.viewSettings.smartRoutingEnabled
                ? assignSmartHandlesWithOptions(
                    state.nodes,
                    state.edges,
                    getSmartRoutingOptionsFromViewSettings(nextViewSettings)
                )
                : state.edges;
            return {
                viewSettings: nextViewSettings,
                edges: nextEdges,
            };
        }),

        setLargeGraphSafetyMode: (mode) => set((state) => ({
            viewSettings: { ...state.viewSettings, largeGraphSafetyMode: mode },
        })),

        setLargeGraphSafetyProfile: (profile) => set((state) => ({
            viewSettings: { ...state.viewSettings, largeGraphSafetyProfile: profile },
        })),

    };
}
