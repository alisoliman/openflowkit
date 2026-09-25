import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EdgeLabelRenderer, useReactFlow, useViewport } from '@/lib/reactflowCompat';
import type { EdgeData, FlowEdge, FlowTab } from '@/lib/types';
import { useFlowStore } from '@/store';
import { getManualWaypoints, getRouteInsertHandles, withManualWaypoints, type Point } from './edgeWaypointControls';
import { getOrthogonalRoutePoints, getOrthogonalSegments, moveOrthogonalSegment } from './orthogonalRouteControls';

interface EdgeRouteControlsProps {
  id: string;
  data?: EdgeData;
  path: string;
  pathRef: React.RefObject<SVGPathElement | null>;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  orthogonal?: boolean;
}

/** Selected-edge controls use canvas coordinates; their targets stay the same size while zooming. */
export function EdgeRouteControls({ id, data, path, pathRef, sourceX, sourceY, targetX, targetY, orthogonal = false }: EdgeRouteControlsProps): React.ReactElement {
  const { getEdges, setEdges, screenToFlowPosition } = useReactFlow();
  const { zoom } = useViewport();
  const instructionsId = useId();
  const points = useMemo(() => getManualWaypoints(data), [data]);
  const [insertHandles, setInsertHandles] = useState(() => getRouteInsertHandles(null, points, { x: sourceX, y: sourceY }, { x: targetX, y: targetY }));
  const endDragRef = useRef<((cancel: boolean) => void) | null>(null);
  const keyboardHistoryRef = useRef(false);
  const suppressClickRef = useRef(false);
  const focusControlRef = useRef<{ kind: 'bend' | 'insert' | 'segment'; index: number } | null>(null);
  const stepRoute = useMemo(() => orthogonal ? getOrthogonalRoutePoints(path, { x: sourceX, y: sourceY }, { x: targetX, y: targetY }) : [], [orthogonal, path, sourceX, sourceY, targetX, targetY]);
  const segments = useMemo(() => getOrthogonalSegments(stepRoute), [stepRoute]);
  const keyboardSegmentRef = useRef<{ route: Point[]; index: number; coordinate: number } | null>(null);

  useLayoutEffect(() => {
    if (!orthogonal) setInsertHandles(getRouteInsertHandles(pathRef.current, points, { x: sourceX, y: sourceY }, { x: targetX, y: targetY }));
  }, [orthogonal, path, pathRef, points, sourceX, sourceY, targetX, targetY]);

  useEffect(() => () => { endDragRef.current?.(true); }, []);

  function currentEdge(): FlowEdge | undefined {
    return getEdges().find((edge) => edge.id === id) as FlowEdge | undefined;
  }

  function updatePoints(nextPoints: Point[]): void {
    if (useFlowStore.getState().agentTurn) return;
    setEdges((edges) => edges.map((edge) => edge.id === id
      ? { ...edge, data: withManualWaypoints(edge.data as EdgeData | undefined, nextPoints) }
      : edge));
  }

  function startDrag(event: React.PointerEvent<HTMLButtonElement>, index: number, point: Point, insert: boolean, orientation?: 'horizontal' | 'vertical'): void {
    if (event.button !== 0 || useFlowStore.getState().agentTurn) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    endDragRef.current?.(true);
    keyboardHistoryRef.current = false;
    keyboardSegmentRef.current = null;
    suppressClickRef.current = false;
    const original = currentEdge();
    if (!original) return;
    const tabId = useFlowStore.getState().activeTabId;
    const initialPoints = getManualWaypoints(original.data);
    const start = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const pointerId = event.pointerId;
    const startClient = { x: event.clientX, y: event.clientY };
    let moved = false;
    let finished = false;
    let cancelled = false;
    let latestData = original.data;
    let previousHistory: FlowTab['history'] | undefined;
    let recordedHistory: FlowTab['history'] | undefined;

    function finish(cancel: boolean): void {
      if (finished) return;
      finished = true;
      cancelled = cancel;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelPointer);
      window.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('blur', cancelWindow);
      endDragRef.current = null;
      suppressClickRef.current = moved;
      if (cancel && moved) {
        if (useFlowStore.getState().activeTabId === tabId) {
          setEdges((edges) => {
            if (useFlowStore.getState().activeTabId !== tabId) return edges;
            return edges.map((edge) => edge.id === id && edge.data === latestData
              ? { ...edge, data: original!.data }
              : edge);
          });
        }
        // A cancelled gesture must not consume redo or add an empty undo step.
        // Retain history created by any action that ran after our snapshot.
        if (previousHistory && recordedHistory) {
          useFlowStore.setState((state) => {
            const tab = state.tabs.find((entry) => entry.id === tabId);
            if (tab?.history !== recordedHistory) return state;
            return { tabs: state.tabs.map((entry) => entry.id === tabId
              ? { ...entry, history: previousHistory! }
              : entry) };
          });
        }
      }
    }

    function move(moveEvent: PointerEvent): void {
      if (moveEvent.pointerId !== pointerId) return;
      const state = useFlowStore.getState();
      if (state.agentTurn || state.activeTabId !== tabId || currentEdge()?.data !== latestData) { finish(true); return; }
      const distance = orientation === 'horizontal' ? Math.abs(moveEvent.clientY - startClient.y)
        : orientation === 'vertical' ? Math.abs(moveEvent.clientX - startClient.x)
          : Math.hypot(moveEvent.clientX - startClient.x, moveEvent.clientY - startClient.y);
      if (!moved && distance < 3) return;
      moveEvent.preventDefault();
      if (!moved) {
        previousHistory = state.tabs.find((tab) => tab.id === tabId)?.history;
        state.recordHistoryV2();
        recordedHistory = useFlowStore.getState().tabs.find((tab) => tab.id === tabId)?.history;
        moved = true;
      }
      const position = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
      let next = initialPoints.slice();
      const nextPoint = { x: point.x + position.x - start.x, y: point.y + position.y - start.y };
      if (orientation) next = moveOrthogonalSegment(stepRoute, index, orientation === 'horizontal' ? nextPoint.y : nextPoint.x).slice(1, -1);
      else if (insert) next.splice(index, 0, nextPoint);
      else next[index] = nextPoint;
      setEdges((edges) => {
        if (cancelled || useFlowStore.getState().activeTabId !== tabId || useFlowStore.getState().agentTurn) return edges;
        return edges.map((edge) => {
          if (edge.id !== id || edge.data !== latestData) return edge;
          latestData = withManualWaypoints(edge.data as EdgeData | undefined, next);
          return { ...edge, data: latestData };
        });
      });
    }

    function up(upEvent: PointerEvent): void {
      if (upEvent.pointerId === pointerId) finish(false);
    }
    function cancelPointer(cancelEvent: PointerEvent): void {
      if (cancelEvent.pointerId === pointerId) finish(true);
    }
    function cancelWindow(): void { finish(true); }
    function keyDown(keyEvent: KeyboardEvent): void {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      keyEvent.stopImmediatePropagation();
      finish(true);
    }
    endDragRef.current = finish;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancelPointer);
    window.addEventListener('keydown', keyDown, true);
    window.addEventListener('blur', cancelWindow);
  }

  function removePoint(index: number): void {
    if (useFlowStore.getState().agentTurn) return;
    const edge = currentEdge();
    if (!edge) return;
    const next = getManualWaypoints(edge.data);
    if (!next[index]) return;
    useFlowStore.getState().recordHistoryV2();
    next.splice(index, 1);
    keyboardHistoryRef.current = false;
    focusControlRef.current = next.length > 0
      ? { kind: 'bend', index: Math.min(index, next.length - 1) }
      : { kind: 'insert', index: 0 };
    updatePoints(next);
  }

  function addPoint(index: number, point: Point): void {
    if (useFlowStore.getState().agentTurn) return;
    const edge = currentEdge();
    if (!edge) return;
    const next = getManualWaypoints(edge.data);
    useFlowStore.getState().recordHistoryV2();
    next.splice(index, 0, { x: point.x, y: point.y });
    keyboardHistoryRef.current = false;
    focusControlRef.current = { kind: 'bend', index };
    updatePoints(next);
  }

  function focusControl(button: HTMLButtonElement | null, kind: 'bend' | 'insert' | 'segment', index: number): void {
    if (!button || focusControlRef.current?.kind !== kind || focusControlRef.current.index !== index) return;
    button.focus({ preventScroll: true });
    focusControlRef.current = null;
  }

  function moveWithKeyboard(event: React.KeyboardEvent<HTMLButtonElement>, index: number): void {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || useFlowStore.getState().agentTurn) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removePoint(index);
      return;
    }
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    const next = getManualWaypoints(currentEdge()?.data);
    if (!next[index]) return;
    if (!keyboardHistoryRef.current) {
      useFlowStore.getState().recordHistoryV2();
      keyboardHistoryRef.current = true;
    }
    const amount = event.shiftKey ? 10 : 1;
    next[index] = { x: next[index].x + delta[0] * amount, y: next[index].y + delta[1] * amount };
    updatePoints(next);
  }

  function controlStyle(point: Point): React.CSSProperties {
    return { position: 'absolute', left: point.x, top: point.y, transform: `translate(-50%, -50%) scale(${1 / Math.max(zoom, 0.1)})`, width: 32, height: 32, pointerEvents: 'all', touchAction: 'none' };
  }

  function resetKeyboardGesture(): void {
    keyboardHistoryRef.current = false;
    keyboardSegmentRef.current = null;
  }

  function moveSegmentWithKeyboard(event: React.KeyboardEvent<HTMLButtonElement>, segment: (typeof segments)[number]): void {
    event.stopPropagation();
    if (event.key === 'Delete' || event.key === 'Backspace') event.preventDefault();
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || useFlowStore.getState().agentTurn) return;
    const offset = segment.orientation === 'horizontal'
      ? { ArrowUp: -1, ArrowDown: 1 }[event.key]
      : { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!offset) return;
    event.preventDefault();
    if (!keyboardHistoryRef.current) {
      useFlowStore.getState().recordHistoryV2();
      keyboardHistoryRef.current = true;
      keyboardSegmentRef.current = { route: stepRoute, index: segment.index, coordinate: segment.orientation === 'horizontal' ? segment.y : segment.x };
    }
    const gesture = keyboardSegmentRef.current;
    if (!gesture) return;
    gesture.coordinate += offset * (event.shiftKey ? 10 : 1);
    updatePoints(moveOrthogonalSegment(gesture.route, gesture.index, gesture.coordinate).slice(1, -1));
  }

  return (
    <>
      {!orthogonal && points.length > 0 && (
        <path className="flow-edge-route-controls" d={`M${sourceX},${sourceY} ${points.map((point) => `L${point.x},${point.y}`).join(' ')} L${targetX},${targetY}`} fill="none" stroke="var(--brand-primary)" strokeWidth={1 / Math.max(zoom, 0.1)} style={{ strokeDasharray: '3 5', opacity: 0.35, animation: 'none' }} pointerEvents="none" aria-hidden="true" />
      )}
      <EdgeLabelRenderer>
        <span id={instructionsId} className="sr-only flow-edge-route-controls">{orthogonal ? 'Move horizontal segments up or down and vertical segments left or right. Use the matching arrow keys, Shift for larger steps. Escape cancels a drag.' : 'Drag to reshape the arrow. Use arrow keys to move a bend, Shift for larger steps, and Delete to remove it. Escape cancels a drag.'}</span>
        {orthogonal && segments.map((segment) => (
          <button key={`segment-${segment.index}`} ref={(button) => focusControl(button, 'segment', segment.index)} type="button" className="flow-edge-route-controls nodrag nopan group z-30 flex items-center justify-center rounded-full outline-offset-2" style={{ ...controlStyle(segment), cursor: segment.orientation === 'horizontal' ? 'ns-resize' : 'ew-resize' }} aria-label={`Move ${segment.orientation} segment ${segment.index + 1}`} aria-describedby={instructionsId} title={segment.orientation === 'horizontal' ? 'Drag up or down · ↑ ↓ to move' : 'Drag left or right · ← → to move'} onPointerDown={(event) => startDrag(event, segment.index, segment, false, segment.orientation)} onKeyDown={(event) => moveSegmentWithKeyboard(event, segment)} onKeyUp={resetKeyboardGesture} onBlur={resetKeyboardGesture} onClick={(event) => event.stopPropagation()}>
            <span className={`rounded-[3px] border border-[var(--brand-primary)] bg-[var(--brand-surface)] shadow-sm group-hover:bg-[var(--brand-primary-100)] ${segment.orientation === 'horizontal' ? 'h-2.5 w-4' : 'h-4 w-2.5'}`} aria-hidden="true" />
          </button>
        ))}
        {!orthogonal && insertHandles.map((point) => (
          <button key={`insert-${point.index}`} ref={(button) => focusControl(button, 'insert', point.index)} type="button" className="flow-edge-route-controls flow-edge-waypoint nodrag nopan group z-20 flex items-center justify-center rounded-full outline-offset-2" style={controlStyle(point)} aria-label={`Add bend ${point.index + 1}`} aria-describedby={instructionsId} title="Drag to add a bend · Enter to add at this point" onPointerDown={(event) => startDrag(event, point.index, point, true)} onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            addPoint(point.index, point);
          }} onClick={(event) => {
            event.stopPropagation();
            if (!suppressClickRef.current) addPoint(point.index, point);
            suppressClickRef.current = false;
          }}>
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[var(--brand-primary)] bg-[var(--brand-surface)] text-[12px] leading-none text-[var(--brand-primary)] shadow-sm group-hover:bg-[var(--brand-primary-100)]" aria-hidden="true">+</span>
          </button>
        ))}
        {!orthogonal && points.map((point, index) => (
          <button key={`bend-${index}`} ref={(button) => focusControl(button, 'bend', index)} type="button" className="flow-edge-route-controls flow-edge-waypoint nodrag nopan group z-30 flex items-center justify-center rounded-full outline-offset-2" style={controlStyle(point)} aria-label={`Bend ${index + 1}`} aria-describedby={instructionsId} title="Drag to move bend · Double-click to remove" onPointerDown={(event) => startDrag(event, index, point, false)} onKeyDown={(event) => moveWithKeyboard(event, index)} onKeyUp={() => { keyboardHistoryRef.current = false; }} onBlur={() => { keyboardHistoryRef.current = false; }} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => { event.stopPropagation(); removePoint(index); }}>
            <span className="h-3.5 w-3.5 rounded-full border-2 border-[var(--brand-surface)] bg-[var(--brand-primary)] shadow-[0_0_0_1px_var(--brand-primary)] group-hover:brightness-110" aria-hidden="true" />
          </button>
        ))}
      </EdgeLabelRenderer>
    </>
  );
}
