/**
 * @jest-environment jsdom
 */
// Studio's number fields (width, height, position, font size, rotation): what
// the user types is what the design gets. The design is clamped to its
// bounds (applySize, applyToTexts); the field used to show that clamped value
// straight away, so the next digit was typed after it.
import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NumberField } from './number-field';

afterEach(cleanup);

const Inspector = ({ start, min, max, onCommit }: { start: number; min: number; max: number; onCommit?: () => void }) => {
  const [value, setValue] = useState(start);
  return (
    <>
      <NumberField
        value={value}
        min={min}
        max={max}
        // Like the canvas: the object never goes outside its bounds.
        onChange={(v) => setValue(Math.min(max, Math.max(min, Math.round(v))))}
        onCommit={onCommit}
        aria-label="field"
      />
      <output data-testid="design">{value}</output>
    </>
  );
};

// Select the field's text and type over it, one key at a time: each key goes
// after whatever the field shows at that moment, as in a browser.
const typeOver = (input: HTMLInputElement, text: string) => {
  fireEvent.focus(input);
  [...text].forEach((ch, i) => {
    fireEvent.change(input, { target: { value: i === 0 ? ch : input.value + ch } });
  });
};

const design = () => Number(screen.getByTestId('design').textContent);

describe('Studio number field', () => {
  it('a width typed as 1320 becomes 1320, not 4320', () => {
    render(<Inspector start={1080} min={4} max={10000} />);
    const input = screen.getByLabelText('field') as HTMLInputElement;
    typeOver(input, '1320');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(design()).toBe(1320);
    expect(input.value).toBe('1320');
  });

  it('a font size typed as 12 becomes 12, not 82', () => {
    render(<Inspector start={48} min={8} max={300} />);
    const input = screen.getByLabelText('field') as HTMLInputElement;
    typeOver(input, '12');
    fireEvent.blur(input);
    expect(design()).toBe(12);
  });

  it('the design follows the keystrokes inside the bounds', () => {
    render(<Inspector start={1080} min={4} max={10000} />);
    const input = screen.getByLabelText('field') as HTMLInputElement;
    typeOver(input, '600');
    expect(design()).toBe(600);
  });

  it('a value past the bound is clamped when the field is left, with one undo step', () => {
    const onCommit = jest.fn();
    render(<Inspector start={1080} min={4} max={10000} onCommit={onCommit} />);
    const input = screen.getByLabelText('field') as HTMLInputElement;
    typeOver(input, '20000');
    fireEvent.blur(input);
    expect(design()).toBe(10000);
    expect(input.value).toBe('10000');
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('Escape puts back the value the field had', () => {
    render(<Inspector start={1080} min={4} max={10000} />);
    const input = screen.getByLabelText('field') as HTMLInputElement;
    typeOver(input, '600');
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(design()).toBe(1080);
  });
});
