import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InspectorField } from './InspectorPrimitives';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { SegmentedChoice } from './SegmentedChoice';

describe('InspectorField labels', () => {
  it('associates a native input and helper while preserving its existing description and event handler', () => {
    const onChange = vi.fn();
    render(
      <>
        <span id="existing-help">Existing hint</span>
        <InspectorField label="Protocol" helper="Choose the transport protocol">
          <input id="protocol" aria-describedby="existing-help" onChange={onChange} />
        </InspectorField>
      </>
    );
    const input = screen.getByRole('textbox', { name: 'Protocol' });
    expect(screen.getByLabelText('Protocol')).toBe(input);
    expect(input.id).toBe('protocol');
    const helperId = screen.getByText('Choose the transport protocol').id;
    expect(input.getAttribute('aria-describedby')).toBe(`existing-help ${helperId}`);
    fireEvent.change(input, { target: { value: 'HTTPS' } });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('labels a shared Select by the field rather than its current selected option', () => {
    render(
      <InspectorField label="Environment" helper="Where this service runs">
        <Select
          value="production"
          onChange={vi.fn()}
          options={[{ value: 'production', label: 'Production' }]}
        />
      </InspectorField>
    );
    const select = screen.getByRole('combobox', { name: 'Environment' });
    expect(select.getAttribute('aria-describedby')).toBe(
      screen.getByText('Where this service runs').id
    );
    expect(screen.getByLabelText('Environment')).toBe(select);
    fireEvent.click(select);
    expect(screen.getByRole('listbox', { name: 'Environment' })).toBeTruthy();
  });

  it('finds a single nested shared Input without losing its forwarded ref', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(
      <InspectorField label="Zone">
        <div>
          <Input ref={ref} />
        </div>
      </InspectorField>
    );
    expect(screen.getByRole('textbox', { name: 'Zone' })).toBe(ref.current);
  });

  it('preserves explicit accessible names and independently labelled shared inputs', () => {
    render(
      <>
        <InspectorField label="Environment">
          <Select
            aria-label="Deployment environment"
            value="production"
            onChange={vi.fn()}
            options={[{ value: 'production', label: 'Production' }]}
          />
        </InspectorField>
        <InspectorField label="Location">
          <Input label="Cloud zone" />
        </InspectorField>
      </>
    );
    expect(screen.getByRole('combobox', { name: 'Deployment environment' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Cloud zone' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Location' })).toBeTruthy();
  });

  it('uses group semantics for multiple controls and segmented choices without overriding their names', () => {
    render(
      <>
        <InspectorField label="Dimensions" helper="Size in pixels">
          <input aria-label="Width" />
          <input aria-label="Height" />
        </InspectorField>
        <InspectorField label="Provider">
          <SegmentedChoice
            items={[
              { id: 'aws', label: 'AWS' },
              { id: 'azure', label: 'Azure' },
            ]}
            selectedId="aws"
            onSelect={vi.fn()}
          />
        </InspectorField>
      </>
    );
    const dimensions = screen.getByRole('group', { name: 'Dimensions' });
    expect(dimensions.getAttribute('aria-describedby')).toBe(screen.getByText('Size in pixels').id);
    expect(screen.getByRole('textbox', { name: 'Width' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Height' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Provider' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'AWS' })).toBeTruthy();
  });
});
