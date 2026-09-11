import { create } from 'zustand';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { useShallow } from 'zustand/react/shallow';
import React, {
  createContext,
  FC,
  memo,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { useFocusTrap } from '@gitroom/frontend/components/ui/use-focus-trap';
import { Button } from '@gitroom/frontend/components/ui/button';
import { useHotkeys } from 'react-hotkeys-hook';
import clsx from 'clsx';
import { EventEmitter } from 'events';

interface OpenModalInterface {
  title?: any;
  closeOnClickOutside?: boolean;
  removeLayout?: boolean;
  fullScreen?: boolean;
  top?: string | number;
  closeOnEscape?: boolean;
  withCloseButton?: boolean;
  askClose?: boolean;
  onClose?: () => void;
  children: ReactNode | ((close: () => void) => ReactNode);
  classNames?: {
    modal?: string;
  };
  size?: string | number;
  maxSize?: string | number;
  height?: string | number;
  id?: string;
}

interface ModalManagerStoreInterface {
  closeById(id: string): void;
  openModal(params: OpenModalInterface): void;
  closeAll(): void;
}

interface State extends ModalManagerStoreInterface {
  modalManager: Array<{ id: string } & OpenModalInterface>;
}

const useModalStore = create<State>((set) => ({
  modalManager: [],
  openModal: (params) => {
    const newId = params.id || makeId(20);
    set((state) => ({
      modalManager: [
        ...state.modalManager,
        ...(!state.modalManager.some((p) => p.id === newId)
          ? [{ id: newId, ...params }]
          : []),
      ],
    }));
  },
  closeById: (id) =>
    set((state) => ({
      modalManager: state.modalManager.filter((modal) => modal.id !== id),
    })),
  closeAll: () => set({ modalManager: [] }),
}));

const CurrentModalContext = createContext({ id: '' });

interface ModalManagerInterface extends ModalManagerStoreInterface {
  closeCurrent(): void;
}

export const useModals = () => {
  const { closeAll, openModal, closeById } = useModalStore(
    useShallow((state) => ({
      openModal: state.openModal,
      closeById: state.closeById,
      closeAll: state.closeAll,
    }))
  );

  const modalContext = useContext(CurrentModalContext);

  return {
    openModal,
    closeAll,
    closeById,
    closeCurrent: () => {
      if (modalContext.id) {
        closeById(modalContext.id);
      }
    },
  } satisfies ModalManagerInterface;
};

export const Component: FC<{
  closeModal: (id: string) => void;
  zIndex: number;
  isLast: boolean;
  modal: { id: string } & OpenModalInterface;
}> = memo(({ isLast, modal, closeModal, zIndex }) => {
  const decision = useDecisionModal();
  const closeModalFunction = useCallback(async () => {
    if (modal.askClose) {
      const open = await decision.open();
      if (!open) {
        return;
      }
    }
    modal?.onClose?.();
    closeModal(modal.id);
  }, [modal.id, closeModal]);

  const RenderComponent = useMemo(() => {
    return typeof modal.children === 'function'
      ? modal.children(closeModalFunction)
      : modal.children;
  }, [modal, closeModalFunction]);

  // enableOnFormTags: without it the hotkey is ignored while the cursor is in
  // an input, so a modal that opens straight into a large textarea — the debug
  // post import is the one in the admin panel — could not be left with the
  // keyboard at all (E2E-09-53).
  useHotkeys(
    'Escape',
    () => {
      if (isLast && modal.closeOnEscape !== false) {
        closeModalFunction();
      }
    },
    { enableOnFormTags: true },
    [isLast, closeModalFunction, modal.closeOnEscape]
  );

  // Focus moves into the dialog and comes back to whatever opened it. It used
  // to stay on the triggering button: the page behind stayed keyboard-reachable
  // under an overlay that could not be seen past (E2E-09-53).
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, isLast);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const opener = document.activeElement as HTMLElement | null;
    // A field first, the close button only as a fallback: landing on Close is
    // correct but unhelpful when the dialog is a form.
    const target =
      panel.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])'
      ) ??
      panel.querySelector<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      );
    target?.focus();
    return () => opener?.focus?.();
  }, []);

  const titleId = `modal-title-${modal.id}`;

  if (modal.removeLayout) {
    return (
      <div
        style={{ zIndex }}
        className={clsx(
          !modal.fullScreen
            ? 'pb-[50px] min-w-full min-h-full'
            : 'w-full h-full',
          'fixed flex left-0 top-0 bg-popup transition-all animate-fadeIn overflow-y-auto text-newTextColor',
          !isLast && '!overflow-hidden'
        )}
      >
        <div className={clsx(modal.fullScreen && 'flex', 'relative flex-1')}>
          <div
            className={clsx(
              modal.fullScreen
                ? 'flex flex-1'
                : 'absolute top-0 left-0 min-w-full min-h-full'
            )}
          >
            <div
              className={clsx(
                modal.fullScreen ? 'w-full h-full flex-1' : 'mx-auto py-[48px]'
              )}
              {...(modal.size && { style: { width: modal.size } })}
            >
              {typeof modal.children === 'function'
                ? modal.children(closeModalFunction)
                : modal.children}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <CurrentModalContext.Provider value={{ id: modal.id }}>
      <div
        onClick={
          modal.closeOnClickOutside === false ? undefined : closeModalFunction
        }
        style={{ zIndex }}
        className={clsx(
          'fixed flex left-0 top-0 min-w-full min-h-full bg-popup transition-all animate-fadeIn overflow-y-auto text-newTextColor',
          !modal.fullScreen && 'pb-[50px]'
        )}
      >
        <div className="relative flex-1">
          <div
            style={
              modal.top
                ? { paddingTop: modal.top, paddingBottom: modal.top }
                : {}
            }
            className={clsx(
              'absolute min-w-full',
              !modal.fullScreen
                ? modal.top
                  ? ''
                  : // A modal that declares its own height is sized against the
                    // viewport (Studio asks for 92vh), so a 100px band above and
                    // below pushes its bottom edge - the Studio format bar, for
                    // one - under the fold on any normal laptop. Keep the band
                    // for the small dialogues that grow to their content.
                    modal.size && modal.height
                    ? 'min-h-full py-[24px]'
                    : 'min-h-full pt-[100px] pb-[100px]'
                : 'h-screen',
              modal.size && modal.height
                ? 'flex justify-center items-center'
                : 'top-0 left-0'
            )}
          >
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              // Only when there is a title to point at. Several modals render
              // their own header and open with no `title`, and a labelledby
              // aimed at an empty node leaves the dialog with no name at all.
              {...(modal.title
                ? { 'aria-labelledby': titleId }
                : { 'aria-label': 'Dialog' })}
              className={clsx(
                !modal.removeLayout && 'gap-[40px] p-[32px]',
                'bg-[rgba(15,23,42,0.92)] backdrop-blur-xl border border-white/10 mx-auto flex flex-col w-fit rounded-[24px] relative animate-modalIn phone:!min-w-0 phone:!w-full phone:!max-w-full',
                modal.classNames?.modal,
                modal.size ? '' : 'min-w-[600px]',
                modal.fullScreen && 'h-full'
              )}
              {...((!!modal.size || !!modal.height || !!modal.maxSize) && {
                style: {
                  ...(modal.size ? { width: modal.size } : {}),
                  ...(modal.height ? { height: modal.height } : {}),
                  ...(modal.maxSize ? { maxWidth: modal.maxSize } : {}),
                },
              })}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center">
                <div id={titleId} className="text-[24px] font-[600] flex-1">
                  {modal.title}
                </div>
                {typeof modal.withCloseButton === 'undefined' ||
                modal.withCloseButton ? (
                  <div className="cursor-pointer">
                    <button
                      className="outline-none absolute end-[20px] top-[20px] mantine-UnstyledButton-root mantine-ActionIcon-root hover:bg-tableBorder cursor-pointer mantine-Modal-close mantine-1dcetaa"
                      type="button"
                      aria-label="Close"
                      onClick={closeModalFunction}
                    >
                      <svg
                        viewBox="0 0 15 15"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                      >
                        <path
                          d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z"
                          fill="currentColor"
                          fillRule="evenodd"
                          clipRule="evenodd"
                        ></path>
                      </svg>
                    </button>
                  </div>
                ) : null}
              </div>
              <div
                className={clsx(
                  'whitespace-pre-line',
                  !!modal.height &&
                    !!modal.size &&
                    'flex flex-1 flex-col min-h-0'
                )}
              >
                {RenderComponent}
              </div>
            </div>
          </div>
        </div>
      </div>
    </CurrentModalContext.Provider>
  );
});

export const ModalManagerInner: FC = () => {
  const { closeModal, modalManager } = useModalStore(
    useShallow((state) => ({
      closeModal: state.closeById,
      modalManager: state.modalManager,
    }))
  );

  useEffect(() => {
    if (modalManager.length > 0) {
      document.querySelector('body')?.classList.add('overflow-hidden');
      Array.from(document.querySelectorAll('.blurMe') || []).map((p) =>
        p.classList.add('blur-xs', 'pointer-events-none')
      );
    } else {
      document.querySelector('body')?.classList.remove('overflow-hidden');
      Array.from(document.querySelectorAll('.blurMe') || []).map((p) =>
        p.classList.remove('blur-xs', 'pointer-events-none')
      );
    }
  }, [modalManager]);

  if (modalManager.length === 0) {
    return null;
  }

  return (
    <>
      <style>{`body, html { overflow: hidden !important; }`}</style>
      {modalManager.map((modal, index) => (
        <Component
          isLast={modalManager.length - 1 === index}
          key={modal.id}
          modal={modal}
          zIndex={200 + index}
          closeModal={closeModal}
        />
      ))}
    </>
  );
};
export const ModalManager: FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <div>
      <ModalManagerEmitter />
      <ModalManagerInner />
      <div className="transition-all w-full">{children}</div>
    </div>
  );
};

const emitter = new EventEmitter();
export const showModalEmitter = (params: ModalManagerInterface) => {
  emitter.emit('show', params);
};

export const ModalManagerEmitter: FC = () => {
  const { showModal } = useModalStore(
    useShallow((state) => ({
      showModal: state.openModal,
    }))
  );

  useEffect(() => {
    emitter.on('show', (params: OpenModalInterface) => {
      showModal(params);
    });

    return () => {
      emitter.removeAllListeners('show');
    };
  }, []);
  return null;
};

export const DecisionModal: FC<{
  description: string;
  approveLabel: string;
  cancelLabel: string;
  onlyApprove: boolean;
  resolution: (value: boolean) => void;
}> = ({ description, cancelLabel, approveLabel, resolution, onlyApprove }) => {
  const { closeCurrent } = useModals();
  return (
    <div className="flex flex-col">
      <div>{description}</div>
      <div className="flex gap-[12px] mt-[16px]">
        <Button
          onClick={() => {
            resolution(true);
            closeCurrent();
          }}
        >
          {approveLabel}
        </Button>
        {!onlyApprove && (
          <Button
            onClick={() => {
              resolution(false);
              closeCurrent();
            }}
          >
            {cancelLabel}
          </Button>
        )}
      </div>
    </div>
  );
};

export const decisionModalEmitter = new EventEmitter();

export const areYouSure = ({
  title = 'Are you sure?',
  description = 'Are you sure you want to close this modal?' as any,
  approveLabel = 'Yes',
  cancelLabel = 'No',
} = {}): Promise<boolean> => {
  return new Promise<boolean>((newRes) => {
    decisionModalEmitter.emit('open', {
      title,
      description,
      approveLabel,
      cancelLabel,
      newRes,
    });
  });
};

export const DecisionEverywhere: FC = () => {
  const decision = useDecisionModal();
  useEffect(() => {
    decisionModalEmitter.on('open', decision.open);
  }, []);
  return null;
};

export const useDecisionModal = () => {
  const modals = useModals();
  const open = useCallback(
    ({
      title = 'Are you sure?',
      description = 'Are you sure you want to close this modal?' as any,
      onlyApprove = false,
      approveLabel = 'Yes',
      cancelLabel = 'No',
      newRes = undefined as any,
    } = {}) => {
      return new Promise<boolean>((res) => {
        modals.openModal({
          title,
          askClose: false,
          onClose: () => res(false),
          children: (
            <DecisionModal
              onlyApprove={onlyApprove}
              resolution={(value) => (newRes ? newRes(value) : res(value))}
              description={description}
              approveLabel={approveLabel}
              cancelLabel={cancelLabel}
            />
          ),
        });
      });
    },
    [modals]
  );

  return { open };
};
