import {
  listenForMediaBox,
  requestMediaBox,
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
});
