// jest-environment-jsdom bundles jsdom 20, which crashes loading the optional
// native `canvas` module; the repo's own jsdom 22 does not, so set it up here.
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
});

import React, { FC } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { act, fireEvent, render, screen } = require('@testing-library/react');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Checkbox } = require('./checkbox');

let form: ReturnType<typeof useForm>;

const Harness: FC<{ disabled?: boolean }> = ({ disabled }) => {
  form = useForm({ defaultValues: { box: false } });
  return (
    <FormProvider {...form}>
      <Checkbox label="Branded content" disabled={disabled} name="box" />
    </FormProvider>
  );
};

describe('Checkbox', () => {
  it('toggles on click when enabled', () => {
    render(<Harness />);
    act(() => {
      fireEvent.click(screen.getByRole('checkbox'));
    });
    expect(form.getValues('box')).toBe(true);
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe(
      'true'
    );
  });

  // E2E-03-06: TikTok's audit requires Branded content to stay unticked
  // while privacy is Self only — the box is disabled, so a click must not
  // change it, whether on the box or on its label.
  it('ignores clicks on the box and the label when disabled', () => {
    render(<Harness disabled />);
    act(() => {
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByText('Branded content'));
    });
    expect(form.getValues('box')).toBe(false);
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe(
      'false'
    );
  });

  it('ignores Space and Enter when disabled', () => {
    render(<Harness disabled />);
    act(() => {
      fireEvent.keyDown(screen.getByRole('checkbox'), { key: ' ' });
      fireEvent.keyDown(screen.getByRole('checkbox'), { key: 'Enter' });
    });
    expect(form.getValues('box')).toBe(false);
  });
});
