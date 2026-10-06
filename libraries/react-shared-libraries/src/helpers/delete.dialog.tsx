import i18next from '@gitroom/react/translation/i18next';
import { areYouSure } from '@gitroom/frontend/components/layout/new-modal';

export const deleteDialog = async (
  message: string,
  confirmButton?: string,
  title?: string,
  cancelButton?: string
) => {
  // Every caller confirms a delete or a disable: the approve button is red.
  return areYouSure({
    destructive: true,
    title: title || i18next.t('are_you_sure', 'Are you sure?'),
    description: message,
    approveLabel:
      confirmButton || i18next.t('yes_delete_it', 'Yes, delete it!'),
    cancelLabel: cancelButton || i18next.t('no_cancel', 'No, cancel!'),
  });
};
