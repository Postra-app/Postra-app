import { useLaunchStore } from './store';

// E2E-05-60 (FE-C-2): "Adapt to each channel" applied each answer with the
// add/remove toggle. A channel version the user made while the AI was
// answering got deleted instead, and the channel fell back to the shared text.
const channel = (id: string) =>
  ({ integration: { id, identifier: 'x', name: id }, settings: {} } as any);

const setUp = () => {
  const store = useLaunchStore.getState();
  store.reset();
  useLaunchStore.setState({
    global: [
      { id: 'p1', content: '<p>shared one</p>', image: [] },
      { id: 'p2', content: '<p>shared two</p>', image: [] },
    ] as any,
    selectedIntegrations: [channel('a'), channel('b')],
  });
};

describe('addAdaptedInternal', () => {
  beforeEach(setUp);

  it('creates the channel version from the shared text with the adapted parts', () => {
    useLaunchStore.getState().addAdaptedInternal('a', ['<p>adapted</p>', null]);
    const [version] = useLaunchStore.getState().internal;
    expect(version.integration.id).toBe('a');
    expect(version.integrationValue.map((v) => v.content)).toEqual([
      '<p>adapted</p>',
      '<p>shared two</p>',
    ]);
  });

  it('keeps a version the user made in the meantime', () => {
    const store = useLaunchStore.getState();
    store.addRemoveInternal('a');
    store.setInternalValueText('a', 0, '<p>written by hand</p>');

    useLaunchStore.getState().addAdaptedInternal('a', ['<p>adapted</p>', null]);
    const internal = useLaunchStore.getState().internal;
    expect(internal).toHaveLength(1);
    expect(internal[0].integrationValue[0].content).toBe('<p>written by hand</p>');
  });

  it('does nothing for a channel that left the post', () => {
    useLaunchStore.setState({ selectedIntegrations: [channel('b')] });
    useLaunchStore.getState().addAdaptedInternal('a', ['<p>adapted</p>', null]);
    expect(useLaunchStore.getState().internal).toEqual([]);
  });
});
