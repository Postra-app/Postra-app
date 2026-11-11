import {
  listenForMediaBox,
  requestMediaBox,
  whenMediaBoxRequested,
} from '@gitroom/frontend/components/media/media-box-request';

describe('the shared media box', () => {
  it('opens for a request made before the box had loaded', () => {
    const pick = jest.fn();
    requestMediaBox(pick);
    const open = jest.fn();
    const stop = listenForMediaBox(open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(pick);
    stop();
  });

  it('opens at once once it listens, and a waiting request is answered once', () => {
    const open = jest.fn();
    const stop = listenForMediaBox(open);
    const pick = jest.fn();
    requestMediaBox(pick);
    expect(open).toHaveBeenCalledWith(pick);
    stop();
    const again = jest.fn();
    listenForMediaBox(again)();
    expect(again).not.toHaveBeenCalled();
  });

  it('a box that stops listening does not take the next request', () => {
    const first = jest.fn();
    const stopFirst = listenForMediaBox(first);
    const second = jest.fn();
    const stopSecond = listenForMediaBox(second);
    stopFirst();
    const pick = jest.fn();
    requestMediaBox(pick);
    expect(second).toHaveBeenCalledWith(pick);
    expect(first).not.toHaveBeenCalled();
    stopSecond();
  });

  it('asks for the box to be loaded only when someone wants it, then opens it', () => {
    const load = jest.fn();
    const stopWaking = whenMediaBoxRequested(load);
    expect(load).not.toHaveBeenCalled();
    const pick = jest.fn();
    requestMediaBox(pick);
    expect(load).toHaveBeenCalledTimes(1);
    const open = jest.fn();
    const stop = listenForMediaBox(open);
    expect(open).toHaveBeenCalledWith(pick);
    stop();
    stopWaking();
  });

  it('loads the box at once for a request made before the layout was ready', () => {
    const pick = jest.fn();
    requestMediaBox(pick);
    const load = jest.fn();
    const stopWaking = whenMediaBoxRequested(load);
    expect(load).toHaveBeenCalledTimes(1);
    const open = jest.fn();
    listenForMediaBox(open)();
    expect(open).toHaveBeenCalledWith(pick);
    stopWaking();
  });
});
