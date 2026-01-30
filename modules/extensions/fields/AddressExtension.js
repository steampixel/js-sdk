import addressFullTemplates from '../../../templates/addressFullTemplates';
import addressPredictionsPopupWrapper from '../../../templates/address_check_wrapper_template.html';
import addressNotFoundPopupWrapper from '../../../templates/address_not_found_wrapper_template.html';
import addressNoPredictionWrapper from '../../../templates/address_no_prediction_wrapper_template.html';
import { diffWords } from 'diff';
import EnderecoSubscriber from '../../subscriber';

const WAIT_FOR_TIME = 100;
const ERROR_EXPIRED_SESSION = -32700;
const MILLISECONDS_IN_SECOND = 1000;
const FOCUS_DELAY = 100;

// Bitmask constants for diff filtering
const DIFF_NEUTRAL = 1;
const DIFF_ADD = 2;
const DIFF_REMOVE = 4;
const DIFF_ALL = DIFF_NEUTRAL | DIFF_ADD | DIFF_REMOVE;

/**
 * Pauses execution for a specified number of milliseconds.
 * @param {number} ms - The number of milliseconds to sleep.
 * @returns {Promise<void>} - A promise that resolves after the specified delay.
 */
const sleep = (ms) => {
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            clearTimeout(timer);
            resolve();
        }, ms);
    });
};

/**
 * Executes callbacks before persisting address check results
 * @param {Object} ExtendableObject - The address object instance
 * @param {Object} finalResult - The result data that will be persisted
 * @returns {Promise} - Resolves when all callbacks have completed
 */
const onBeforeResultPersisted = async (ExtendableObject, finalResult) => {
    try {
        // Initialize callback collection if not exists
        if (!Array.isArray(ExtendableObject.onBeforeAddressPersisted)) {
            ExtendableObject.onBeforeAddressPersisted = [];
        }

        // Collect all promises returned from callbacks
        const promises = ExtendableObject.onBeforeAddressPersisted.map(cb => {
            const result = cb(ExtendableObject, finalResult);

            // Check if the result is a promise
            return result instanceof Promise ? result : Promise.resolve(result);
        });

        // Wait for all promises to resolve
        await Promise.all(promises);
    } catch (err) {
        console.warn('Error in onBeforeResultPersisted callbacks:', {
            error: err
        });
    }
};

/**
 * Executes callbacks after persisting address check results
 * @param {Object} ExtendableObject - The address object instance
 * @param {Object} finalResult - The result data that was persisted
 * @returns {Promise} - Resolves when all callbacks have completed
 */
const onAfterResultPersisted = async (ExtendableObject, finalResult) => {
    try {
        // Initialize callback collection if not exists
        if (!Array.isArray(ExtendableObject.onAfterAddressPersisted)) {
            ExtendableObject.onAfterAddressPersisted = [];
        }

        // Collect all promises returned from callbacks
        const promises = ExtendableObject.onAfterAddressPersisted.map(cb => {
            const result = cb(ExtendableObject, finalResult);

            // Check if the result is a promise
            return result instanceof Promise ? result : Promise.resolve(result);
        });

        // Wait for all promises to resolve
        await Promise.all(promises);
    } catch (err) {
        console.warn('Error in onAfterResultPersisted callbacks:', {
            error: err
        });
    }
};

/**
 * Waits until the specified key becomes the first in the queue
 * @param {string} key - The key to wait for
 * @param {number} checkInterval - Interval in ms to check the queue (default: 100ms)
 * @returns {Promise} - Resolves when the key is first, rejects if key is removed or on timeout
 */
const waitForTurn = (key, checkInterval = WAIT_FOR_TIME) => {
    return new Promise((resolve, reject) => {
        if (isFirstInQueue(key)) {
            resolve();

            return;
        }
        const intervalId = setInterval(() => {
            if (isFirstInQueue(key)) {
                clearInterval(intervalId);
                resolve();
            }
        }, checkInterval);
    });
};

/**
 * Check if a key is the first in the queue
 * @param {string} key - The key to check
 * @returns {boolean} - True if the key is first in the queue
 */
const isFirstInQueue = (key) => {
    const integrator = window.EnderecoIntegrator;
    const processLevel = integrator.getProcessLevel();

    if (integrator.processQueue.size === 0) return false;

    // Use ProcessQueue's optimized isFirst method
    return integrator.processQueue.isFirst(key, processLevel);
};

/**
 * Generates a cache key for an address object.
 * @param {Object} address - The address object.
 * @returns {string} - The generated cache key.
 */
const generateAddressCacheKey = (address) => {
    const fields = [
        'countryCode',
        'subdivisionCode',
        'postalCode',
        'locality',
        'streetFull',
        'streetName',
        'buildingNumber',
        'additionalInfo'
    ];

    const values = fields.map(field =>
        Object.prototype.hasOwnProperty.call(address, field) ? String(address[field]).trim() : '-'
    );

    return values.join('|');
};

/**
 * Attaches event handlers for closing the modal.
 * @param {Object} ExtendableObject - The address object instance.
 * @param {HTMLElement} modalElement - The modal element.
 * @param {Function} onClose - The callback function to execute when the modal is closed.
 */
const attachModalCloseHandlers = (ExtendableObject, modalElement, onClose) => {
    modalElement.querySelectorAll('[endereco-modal-close]').forEach(element => {
        element.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            try {
                // Collect all promises returned from callbacks
                const promises = ExtendableObject.onCloseModal.map(cb => {
                    const result = cb(ExtendableObject);

                    // Check if the result is a promise
                    return result instanceof Promise ? result : Promise.resolve(result);
                });

                // Wait for all promises to resolve
                await Promise.all(promises);
            } catch (err) {
                console.warn('Error in modal close action custom callbacks:', {
                    error: err
                });
            }

            try {
                onClose();
            } catch (err) {
                console.warn('Error in model close handler handler:', {
                    error: err,
                    dataObject: ExtendableObject
                });
            }

            ExtendableObject.util.removePopup();
        });
    });
};

/**
 * Attaches event handlers for editing the address.
 * @param {Object} ExtendableObject - The address object instance.
 * @param {HTMLElement} modalElement - The modal element.
 * @param {Function} onEdit - The callback function to execute when the address is edited.
 */
const attachEditAddressHandlers = (ExtendableObject, modalElement, onEdit) => {
    modalElement.querySelectorAll('[endereco-edit-address]').forEach(element => {
        element.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Disable the element to prevent double-clicking
            element.disabled = true;

            try {
                // Collect all promises returned from callbacks
                const promises = ExtendableObject.onEditAddress.map(cb => {
                    const result = cb(ExtendableObject);

                    // Check if the result is a promise
                    return result instanceof Promise ? result : Promise.resolve(result);
                });

                // Wait for all promises to resolve
                await Promise.all(promises);
            } catch (err) {
                console.warn('Error in model edit action custom callbacks:', {
                    error: err
                });
            }

            try {
                onEdit();
            } catch (err) {
                console.warn('Error in model edit action handler:', {
                    error: err,
                    dataObject: ExtendableObject
                });
            }

            // Re-enable the element if there's an error in the second try-catch block
            element.disabled = false;
            // Only remove popup after all callbacks have completed
            ExtendableObject.util.removePopup();
        });
    });
};

/**
 * Attaches event handlers for selecting an address prediction.
 * @param {Object} ExtendableObject - The address object instance.
 * @param {HTMLElement} modalElement - The modal element.
 * @param {Function} onSelect - The callback function to execute when an address prediction is selected.
 */
const attachSelectionHandlers = (ExtendableObject, modalElement, onSelect) => {
    modalElement.querySelectorAll('[endereco-use-selection]').forEach(element => {
        element.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Disable the element to prevent double-clicking
            element.disabled = true;

            try {
                // Collect all promises returned from callbacks
                const promises = ExtendableObject.onAfterAddressCheckSelected.map(cb => {
                    const result = cb(ExtendableObject);

                    // Check if the result is a promise
                    return result instanceof Promise ? result : Promise.resolve(result);
                });

                // Wait for all promises to resolve
                await Promise.all(promises);
            } catch (err) {
                console.warn('Error in model select action custom callbacks:', {
                    error: err
                });
            }

            try {
                onSelect(
                    parseInt(modalElement.querySelector("[name='endereco-address-predictions']:checked").value)
                );
            } catch (err) {
                console.warn('Error in modal select correction handler:', {
                    error: err,
                    dataObject: ExtendableObject
                });
            }

            // Re-enable the element if there's an error in the second try-catch block
            element.disabled = false;
            ExtendableObject.util.removePopup();
        });
    });
};

/**
 * Attaches event handlers for radio inputs of address predictions.
 * @param {Object} ExtendableObject - The address object instance.
 * @param {HTMLElement} modalElement - The modal element.
 */
const attachPredictionsRadioHandlers = (ExtendableObject, modalElement) => {
    const predictionInputs = modalElement.querySelectorAll('[name="endereco-address-predictions"]');

    // Add subscribers for value syncing
    predictionInputs.forEach(input => {
        ExtendableObject.addSubscriber(
            new EnderecoSubscriber(
                'addressPredictionsIndex',
                input,
                { syncValue: true }
            )
        );
    });

    // Add change event handlers
    predictionInputs.forEach(input => {
        input.addEventListener('change', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const modal = e.target.closest('.endereco-modal');
            const selectedValue = parseInt(e.target.value);

            // Handle origin display toggle
            const originElements = modal.querySelectorAll('[endereco-show-if-origin]');

            originElements.forEach(element => {
                element.style.display = selectedValue >= 0 ? 'none' : 'block';
            });

            const confirmCheckbox = modalElement.querySelector('[endereco-confirm-address-checkbox]');

            if (confirmCheckbox) {
                const isChecked = confirmCheckbox.checked;

                modal.querySelectorAll('[endereco-disabled-until-confirmed]').forEach(element => {
                    element.disabled = !(isChecked || (selectedValue >= 0));
                });
            }
        });

        // Apply initial states
        const modal = input.closest('.endereco-modal');
        const currentValue = ExtendableObject.addressPredictionsIndex;

        // Set initial origin visibility
        modal.querySelectorAll('[endereco-show-if-origin]').forEach(element => {
            element.style.display = currentValue >= 0 ? 'none' : 'block';
        });
    });
};

/**
 * Attaches event handlers for confirming the address.
 * @param {Object} ExtendableObject - The address object instance.
 * @param {HTMLElement} modalElement - The modal element.
 * @param {Function} onConfirm - The callback function to execute when the address is confirmed.
 */
const attachConfirmAddressHandlers = (ExtendableObject, modalElement, onConfirm) => {
    modalElement.querySelectorAll('[endereco-confirm-address]').forEach(element => {
        element.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Disable the element to prevent double-clicking
            element.disabled = true;

            try {
                // Collect all promises returned from callbacks
                const promises = ExtendableObject.onConfirmAddress.map(cb => {
                    const result = cb(ExtendableObject);

                    // Check if the result is a promise
                    return result instanceof Promise ? result : Promise.resolve(result);
                });

                // Wait for all promises to resolve
                await Promise.all(promises);
            } catch (err) {
                console.warn('Error in model confirm action custom callbacks:', {
                    error: err
                });
            }

            try {
                await onConfirm();
            } catch (err) {
                console.warn('Error in modal confirm address handler:', {
                    error: err,
                    dataObject: ExtendableObject
                });
            }

            // Re-enable the element if there's an error in the second try-catch block
            element.disabled = false;
            ExtendableObject.util.removePopup();
        });
    });
};

/**
 * Sets up focus trap for modal accessibility.
 * @param {Object} ExtendableObject - The address object instance.
 * @param {HTMLElement} modalElement - The modal element.
 */
const setupFocusTrap = (ExtendableObject, modalElement) => {
    ExtendableObject._previouslyFocusedElement = document.activeElement;

    const setupRadioRovingTabindex = () => {
        const radios = modalElement.querySelectorAll('input[type="radio"][name="endereco-address-predictions"]');

        if (radios.length === 0) return;

        let checkedRadio = Array.from(radios).find(radio => radio.checked);

        if (!checkedRadio) {
            checkedRadio = radios[0];
            checkedRadio.checked = true;
        }

        radios.forEach(radio => {
            radio.tabIndex = radio === checkedRadio ? 1 : -1;
        });

        // Scroll checked radio into view on initial render
        if (checkedRadio) {
            const checkedLabel = checkedRadio.nextElementSibling;

            if (checkedLabel) {
                checkedLabel.scrollIntoView({ behavior: 'auto', block: 'nearest' });
            }
        }

        radios.forEach(radio => {
            radio.addEventListener('keydown', (e) => {
                let newIndex = -1;
                const currentIndex = Array.from(radios).indexOf(radio);

                if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    newIndex = (currentIndex + 1) % radios.length;
                } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    newIndex = (currentIndex - 1 + radios.length) % radios.length;
                }

                if (newIndex !== -1) {
                    radios[newIndex].tabIndex = 1;
                    radios[newIndex].checked = true;
                    radios[newIndex].focus();
                    radio.tabIndex = -1;

                    // Scroll the radio button's label into view
                    const label = radios[newIndex].nextElementSibling;

                    if (label) {
                        label.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }

                    radios[newIndex].dispatchEvent(new Event('change', { bubbles: true }));
                }
            });

            radio.addEventListener('focus', () => {
                radios.forEach((r) => {
                    r.tabIndex = -1;
                });
                radio.tabIndex = 1;
            });
        });
    };

    setupRadioRovingTabindex();

    const getFirstAndLastFocusable = () => {
        const focusableSelector = [
            'input:not([disabled]):not([tabindex="-1"])',
            'button:not([disabled]):not([tabindex="-1"])',
            'a[href]:not([tabindex="-1"])',
            '[tabindex]:not([tabindex="-1"]):not([disabled])'
        ].join(',');

        const allFocusable = Array.from(modalElement.querySelectorAll(focusableSelector));

        const visibleFocusable = allFocusable.filter(el => {
            return el.offsetParent !== null || el.tagName === 'SPAN'; // SPAN for close button
        });

        visibleFocusable.sort((a, b) => {
            const aIdx = a.tabIndex || 0;
            const bIdx = b.tabIndex || 0;

            return aIdx - bIdx;
        });

        return {
            first: visibleFocusable[0],
            last: visibleFocusable[visibleFocusable.length - 1]
        };
    };

    const handleTabKey = (e) => {
        if (e.key !== 'Tab') return;

        const { first, last } = getFirstAndLastFocusable();

        if (!first) return;

        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last?.focus();
            }
        } else {
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    };

    const handleEditLinkActivation = (e) => {
        const editLinks = modalElement.querySelectorAll('[endereco-edit-address]');

        editLinks.forEach(editLink => {
            if (editLink && e.target === editLink && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                e.stopPropagation();

                editLink.click();
            }
        });
    };

    const handleCloseButtonActivation = (e) => {
        const closeButton = modalElement.querySelector('[endereco-modal-close]');

        if (closeButton && e.target === closeButton && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            e.stopPropagation();

            closeButton.click();
        }
    };

    const handleEscapeKey = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();

            const closeButton = modalElement.querySelector('[endereco-modal-close]');

            if (closeButton) {
                closeButton.click();
            }
        }
    };

    modalElement.addEventListener('keydown', handleTabKey);
    modalElement.addEventListener('keydown', handleEscapeKey);
    modalElement.addEventListener('keydown', handleEditLinkActivation);
    modalElement.addEventListener('keydown', handleCloseButtonActivation);

    const { first } = getFirstAndLastFocusable();

    if (first) {
        // Use setTimeout to ensure modal is fully rendered
        setTimeout(() => {
            first.focus();
        }, FOCUS_DELAY);
    }

    ExtendableObject._focusTrapCleanup = () => {
        if (modalElement && modalElement.removeEventListener) {
            modalElement.removeEventListener('keydown', handleTabKey);
            modalElement.removeEventListener('keydown', handleEscapeKey);
            modalElement.removeEventListener('keydown', handleEditLinkActivation);
            modalElement.removeEventListener('keydown', handleCloseButtonActivation);
        }
    };

    // Register focus restoration as a modal close callback to ensure it completes before modal removal
    ExtendableObject.onCloseModal.push((ExtendableObject) => {
        return restoreFocus(ExtendableObject);
    });
};

/**
 * Restores focus to the previously focused element.
 * @param {Object} ExtendableObject - The address object instance.
 */
const restoreFocus = (ExtendableObject) => {
    if (ExtendableObject._focusTrapCleanup) {
        ExtendableObject._focusTrapCleanup();
        ExtendableObject._focusTrapCleanup = null;
    }

    if (ExtendableObject._previouslyFocusedElement &&
        document.body.contains(ExtendableObject._previouslyFocusedElement)) {
        try {
            ExtendableObject._previouslyFocusedElement.focus();
        } catch (error) {
            // Fallback: focus document body if element is no longer focusable
            console.warn('Could not restore focus to previous element:', error);
            document.body.focus();
        }
    }

    ExtendableObject._previouslyFocusedElement = null;
};

/**
 * Attaches event handlers for the confirmation checkbox.
 * @param {Object} ExtendableObject - The address object instance.
 * @param {HTMLElement} modalElement - The modal element.
 */
const attachConfirmationCheckboxHandlers = (ExtendableObject, modalElement) => {
    if (!ExtendableObject.config.ux.confirmWithCheckbox) {
        return;
    }

    modalElement.querySelectorAll('[endereco-confirm-address-checkbox]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isChecked = e.target.checked;
            const predictionsAmount = e.target.closest('.endereco-modal').querySelectorAll('[name="endereco-address-predictions"]').length;

            e.target.closest('.endereco-modal').querySelectorAll('[endereco-disabled-until-confirmed]').forEach(element => {
                if (predictionsAmount > 0) {
                    element.disabled = !(isChecked || (ExtendableObject.addressPredictionsIndex >= 0));
                } else {
                    element.disabled = !isChecked;
                }
            });
        });

        // Apply initial state
        const isChecked = checkbox.checked;
        const predictionsAmount = checkbox.closest('.endereco-modal').querySelectorAll('[name="endereco-address-predictions"]').length;

        checkbox.closest('.endereco-modal').querySelectorAll('[endereco-disabled-until-confirmed]').forEach(element => {
            if (predictionsAmount > 0) {
                element.disabled = !(isChecked || (ExtendableObject.addressPredictionsIndex >= 0));
            } else {
                element.disabled = !isChecked;
            }
        });
    });
};

/**
 * Generates address validation errors based on status codes.
 * @param {Object} ExtendableObject - The address object instance.
 * @param {string[]} statuscodes - An array of status codes.
 * @returns {Object} - An object containing field errors and invalid fields.
 */
const generateAddressValidationErrors = (ExtendableObject, statuscodes) => {
    const result = {
        fieldErrors: [],
        invalidFields: new Set()
    };

    // Helper to get text from config or fallback
    const getStatusText = (code, fallback) => {
        return window.EnderecoIntegrator.config.texts.errorMessages?.[code] || fallback;
    };
    const isNormalAddress = ['general_address', 'billing_address', 'shipping_address'].includes(ExtendableObject.addressType) &&
        !statuscodes.includes('address_is_packstation') && !statuscodes.includes('address_is_postoffice');

    const isPackstation = ['packstation'].includes(ExtendableObject.addressType) ||
        statuscodes.includes('address_is_packstation');

    const isPostoffice = ['postoffice'].includes(ExtendableObject.addressType) ||
        statuscodes.includes('address_is_postoffice');

    const fieldErrorRules = [
        {
            validate: (ExtendableObject, statuscodes) => {
                return isNormalAddress &&
                    !statuscodes.includes('street_full_not_found') &&
                    statuscodes.includes('building_number_is_missing');
            },
            fieldClass: 'endereco-invalid-building-number',
            messageId: 'address_has_missing_building_number_content',
            defaultMessage: 'Die Hausnummer fehlt in der Eingabe.'
        },
        {
            validate: (ExtendableObject, statuscodes) => {
                return isNormalAddress &&
                    statuscodes.includes('street_full_not_found') &&
                    statuscodes.includes('building_number_is_missing');
            },
            fieldClass: 'endereco-invalid-street-full',
            messageId: 'address_has_missing_building_number_content',
            defaultMessage: 'Die Hausnummer fehlt in der Eingabe.'
        },
        {
            validate: (ExtendableObject, statuscodes) => {
                return isNormalAddress &&
                    statuscodes.includes('street_full_not_found') &&
                    statuscodes.includes('building_number_not_found') &&
                    !statuscodes.includes('building_number_is_missing');
            },
            fieldClass: 'endereco-invalid-street-full',
            messageId: 'address_has_unresolvable_building_number_content',
            defaultMessage: 'Mit der eingegebenen Hausnummer konnte die Adresse nicht verifiziert werden.'
        },
        {
            validate: (ExtendableObject, statuscodes) => {
                return isNormalAddress &&
                    !statuscodes.includes('street_full_not_found') &&
                    statuscodes.includes('building_number_not_found') &&
                    !statuscodes.includes('building_number_is_missing');
            },
            fieldClass: 'endereco-invalid-building-number',
            messageId: 'address_has_unresolvable_building_number_content',
            defaultMessage: 'Mit der eingegebenen Hausnummer konnte die Adresse nicht verifiziert werden.'
        },
        {
            validate: (ExtendableObject, statuscodes) => {
                return isPackstation && statuscodes.includes('address_not_found') &&
                    !(statuscodes.includes('additional_info_needs_correction') ||
                        statuscodes.includes('additional_info_not_found')
                    );
            },
            fieldClass: 'endereco-invalid-packstation-address',
            messageId: 'packstation_has_unresolvable_address',
            defaultMessage: 'Die Packstation-Adresse konnte nicht gefunden werden.'
        },
        {
            validate: (ExtendableObject, statuscodes) => {
                return isPostoffice && statuscodes.includes('address_not_found') &&
                    !(statuscodes.includes('additional_info_needs_correction') ||
                        statuscodes.includes('additional_info_not_found')
                    );
            },
            fieldClass: 'endereco-invalid-packstation-address',
            messageId: 'postoffice_has_unresolvable_address',
            defaultMessage: 'Die Postfilialen-Adresse konnte nicht gefunden werden.'
        },
        {
            validate: (ExtendableObject, statuscodes) => {
                return (isPackstation || isPostoffice) &&
                    !statuscodes.includes('additional_info_is_missing') &&
                    (statuscodes.includes('additional_info_needs_correction') ||
                        statuscodes.includes('additional_info_not_found'));
            },
            fieldClass: 'endereco-invalid-postnummer',
            messageId: 'packstation_has_unresolvable_postnummer',
            defaultMessage: 'Die Postnummer ist ungültig.'
        },
        {
            validate: (ExtendableObject, statuscodes) => {
                return (isPackstation || isPostoffice) &&
                    statuscodes.includes('additional_info_is_missing');
            },
            fieldClass: 'endereco-invalid-postnummer',
            messageId: 'packstation_has_missing_postnummer',
            defaultMessage: 'Die Postnummer fehlt in der Eingabe.'
        }
    ];

    fieldErrorRules.forEach(rule => {
        if (rule.validate(ExtendableObject, statuscodes)) {
            const errorMessage = getStatusText(rule.messageId, rule.defaultMessage);

            result.fieldErrors.push(errorMessage);
            result.invalidFields.add(rule.fieldClass);
        }
    });

    result.invalidFields = Array.from(result.invalidFields);

    return result;
};

/**
 * Checks if the address correction was automatic.
 * @param {string[]} statuscodes - An array of status codes.
 * @returns {boolean} - True if the correction was automatic, false otherwise.
 */
const isAutomaticCorrection = (statuscodes) => {
    return statuscodes.includes('address_correct') || statuscodes.includes('address_minor_correction');
};

/**
 * Checks if the address is correct.
 * @param {string[]} statuscodes - An array of status codes.
 * @returns {boolean} - True if the address is correct, false otherwise.
 */
const isAddressCorrect = (statuscodes) => {
    return statuscodes.includes('address_correct');
};

/**
 * Checks if prediction or meta feedback is needed.
 * @param {string[]} statuscodes - An array of status codes.
 * @param {Array} predictions - An array of address predictions.
 * @returns {boolean} - True if prediction or meta feedback is needed, false otherwise.
 */
const isPredictionOrMetaFeedbackNeeded = (statuscodes, predictions) => {
    // Case when there are multiple predictions
    return predictions.length > 0 &&
        (statuscodes.includes('address_multiple_variants') || statuscodes.includes('address_needs_correction'));
};

/**
 * Checks if only meta feedback is needed.
 * @param {string[]} statuscodes - An array of status codes.
 * @param {Array} predictions - An array of address predictions.
 * @returns {boolean} - True if only meta feedback is needed, false otherwise.
 */
const isOnlyMetaFeedbackNeeded = (statuscodes, predictions) => {
    return statuscodes.includes('address_not_found') || predictions.length === 0;
};

const AddressExtension = {
    name: 'AddressExtension',

    /**
     * Registers properties for the AddressExtension.
     * @param {Object} ExtendableObject - The object to extend.
     */
    registerProperties: (ExtendableObject) => {
        // Internal storage for field values
        ExtendableObject._addressStatus = [];
        ExtendableObject._addressPredictions = [];
        ExtendableObject._addressTimestamp = [];
        ExtendableObject._addressType = 'general_address';
        ExtendableObject._intent = 'edit';
        ExtendableObject._targetSelector = 'body';
        ExtendableObject._insertPosition = 'beforeend';

        // Subscriber storage
        ExtendableObject._subscribers.address = [];
        ExtendableObject._subscribers.addressStatus = [];
        ExtendableObject._subscribers.addressPredictions = [];
        ExtendableObject._subscribers.addressPredictionsIndex = [];
        ExtendableObject._subscribers.addressTimestamp = [];
        ExtendableObject._subscribers.addressType = [];

        // Cache
        ExtendableObject._checkedAddress = {};
        ExtendableObject._lastBlurCheckedAddress = {};
        ExtendableObject.addressCheckCache = {
            cachedResults: {}
        };

        // Flags
        ExtendableObject._addressIsBeingChecked = false;
        ExtendableObject._isIntegrityOperationSynchronous = false;

        // Timeout and sequence
        ExtendableObject._addressCheckRequestIndex = 0;
        ExtendableObject._addressCheckRoutineCounter = 0;
        ExtendableObject._addressPredictionsIndex = 0;
        ExtendableObject._openDropdowns = 0;
        ExtendableObject.onBlurTimeout = null;
        ExtendableObject._addressCheckQueue = {};
        ExtendableObject._addressCheckPromise = null;

        // Callback collectors.
        ExtendableObject.onAfterAddressCheckNoAction = [];
        ExtendableObject.onAfterAddressCheck = [];
        ExtendableObject.onAfterAddressCheckSelected = [];
        ExtendableObject.onAfterModalRendered = [];
        ExtendableObject.onBeforeAddressPersisted = [];
        ExtendableObject.onAfterAddressPersisted = [];
        ExtendableObject.onEditAddress = [];
        ExtendableObject.onConfirmAddress = [];

        // Focus management for accessibility
        ExtendableObject._previouslyFocusedElement = null;
        ExtendableObject._focusTrapCleanup = null;
    },

    /**
     * Registers fields and their getters/setters for the AddressExtension.
     * @param {Object} ExtendableObject - The object to extend.
     */
    registerFields: (ExtendableObject) => {
        /**
         * Gets the current intent.
         * @returns {string} - The current intent.
         */
        ExtendableObject.getIntent = () => {
            return ExtendableObject._intent;
        };

        /**
         * Sets the current intent.
         * @param {string} intent - The intent to set.
         */
        ExtendableObject.setIntent = (intent) => {
            ExtendableObject._intent = intent;
        };

        /**
         * Gets the current targetSelector.
         * @returns {string} - The current DOM target.
         */
        ExtendableObject.getTargetSelector = () => {
            return ExtendableObject._targetSelector;
        };

        /**
         * Sets the current targetSelector.
         * @param {string} targetSelector - The DOM target.
         */
        ExtendableObject.setTargetSelector = (targetSelector) => {
            ExtendableObject._targetSelector = targetSelector;
        };

        /**
         * Gets the current insertPosition.
         * @returns {string} - The current DOM target insert position.
         */
        ExtendableObject.getInsertPosition = () => {
            return ExtendableObject._insertPosition;
        };

        /**
         * Sets the current insertPosition.
         * @param {string} insertPosition - The DOM target insert position.
         */
        ExtendableObject.setInsertPosition = (insertPosition) => {
            if (insertPosition == null) { insertPosition = 'beforeend'; }
            const validInsertPositions = ['beforebegin', 'afterbegin', 'beforeend', 'afterend'];

            if (!validInsertPositions.includes(insertPosition)) {
                throw new Error(`Invalid insertPosition "${insertPosition}". Allowed values are: ${validInsertPositions.join(', ')}`);
            }
            ExtendableObject._insertPosition = insertPosition;
        };

        // Add getter and setter for fields.
        Object.defineProperty(ExtendableObject, 'address', {
            get: () => {
                return ExtendableObject.getAddress();
            },
            set: (value) => {
                // eslint-disable-next-line no-unused-vars
                const _ = ExtendableObject.setAddress(value);
            }
        });

        /**
         * Gets the current address object.
         * @returns {Object} - The current address object.
         */
        ExtendableObject.getAddress = () => {
            const address = {};

            ExtendableObject.fieldNames.forEach(fieldName => {
                address[fieldName] = ExtendableObject[fieldName];
            });

            const optionalFields = [
                'subdivisionCode',
                'streetFull',
                'streetName',
                'buildingNumber',
                'additionalInfo'
            ];

            optionalFields.forEach(fieldName => {
                if (!ExtendableObject.util.hasSubscribedField(fieldName) &&
                    Object.prototype.hasOwnProperty.call(address, fieldName)
                ) {
                    delete address[fieldName];
                }
            });

            const hasStreetName = ExtendableObject.util.hasSubscribedField('streetName');
            const hasStreetFull = ExtendableObject.util.hasSubscribedField('streetFull');

            // If both fields exist in the formular, then we fall back to config to find out which is primary
            if (hasStreetName && hasStreetFull) {
                if (ExtendableObject.config.splitStreet) {
                    delete address.streetFull;
                } else {
                    delete address.streetName;
                    delete address.buildingNumber;
                }
            }

            return address;
        };

        /**
         * Sets the current address object.
         * @param {Object} address - The address object to set.
         * @returns {Promise<void>} - A promise that resolves when the address is set.
         */
        ExtendableObject.setAddress = async (address) => {
            try {
                const resolvedValue = await ExtendableObject.util.Promise.resolve(address);
                const addressValue = await ExtendableObject.cb.setAddress(resolvedValue);

                const setterPromises = ExtendableObject.fieldNames.map(fieldName => {
                    if (Object.prototype.hasOwnProperty.call(addressValue, fieldName) &&
                        typeof addressValue[fieldName] === 'string'
                    ) {
                        // Dynamically calculate the setter name (e.g., "streetName" -> "setStreetName")
                        const setterName = `set${fieldName.charAt(0).toUpperCase()}${fieldName.slice(1)}`;

                        if (typeof ExtendableObject[setterName] === 'function') {
                            return ExtendableObject[setterName](addressValue[fieldName]);
                        }
                    }

                    return Promise.resolve();
                });

                // Wait for all setter promises to complete
                await Promise.all(setterPromises);
            } catch (err) {
                console.warn('Error setting address fields', {
                    error: err,
                    valueToSet: address
                });
                throw err;
            }
        };

        // Add the "addressStatus" property
        Object.defineProperty(ExtendableObject, 'addressStatus', {
            get: () => {
                return ExtendableObject.getAddressStatus();
            },
            set: (value) => {
                // eslint-disable-next-line no-unused-vars
                const _ = ExtendableObject.setAddressStatus(value);
            }
        });

        /**
         * Gets the current address status.
         * @returns {string[]} - The current address status.
         */
        ExtendableObject.getAddressStatus = () => {
            return Array.isArray(ExtendableObject._addressStatus)
                ? ExtendableObject._addressStatus
                : [];
        };

        /**
         * Sets the current address status.
         * @param {string[]|string} value - The address status to set.
         * @returns {Promise<void>} - A promise that resolves when the address status is set.
         */
        ExtendableObject.setAddressStatus = async (value) => {
            try {
                const resolvedValue = await ExtendableObject.util.Promise.resolve(value);

                // Decode. The value can come from DOM element as string.
                let decodedValue;

                if (typeof resolvedValue === 'string') {
                    // Split comma-separated string into array, trim whitespace
                    decodedValue = resolvedValue.split(',').map(item => item.trim());
                } else if (Array.isArray(resolvedValue)) {
                    decodedValue = resolvedValue;
                } else {
                    decodedValue = []; // Default for other types
                }

                // Fix for outdated status codes. They should not be processed or even used.
                const removeOutdatedValues = (array) => {
                    return array.filter(item =>
                        item !== 'not-checked' && item !== 'address_not_checked'
                    );
                };

                decodedValue = removeOutdatedValues(decodedValue);

                ExtendableObject._addressStatus = decodedValue;

                // Inform all subscribers about the change.
                const notificationProcesses = [];

                ExtendableObject._subscribers.addressStatus.forEach((subscriber) => {
                    try {
                        notificationProcesses.push(
                            subscriber.updateDOMValue(
                                Array.isArray(decodedValue)
                                    ? decodedValue.join(',')
                                    : String(decodedValue)
                            )
                        );
                    } catch (subErr) {
                        console.warn('Failed to update addressStatus subscriber:', {
                            error: subErr,
                            value: decodedValue
                        });
                    }
                });
                await Promise.all(notificationProcesses);
            } catch (err) {
                ExtendableObject._addressStatus = ExtendableObject._addressStatus || [];
                console.warn('Failed to set address status', {
                    error: err,
                    value
                });
            }
        };

        Object.defineProperty(ExtendableObject, 'addressPredictions', {
            get: () => {
                return ExtendableObject.getAddressPredictions();
            },
            set: (value) => {
                // eslint-disable-next-line no-unused-vars
                const _ = ExtendableObject.setAddressPredictions(value);
            }
        });

        /**
         * Gets the current address predictions.
         * @returns {Array} - The current address predictions.
         */
        ExtendableObject.getAddressPredictions = () => {
            return Array.isArray(ExtendableObject._addressPredictions)
                ? ExtendableObject._addressPredictions
                : [];
        };

        /**
         * Sets the current address predictions.
         * @param {Array|string} value - The address predictions to set.
         * @returns {Promise<void>} - A promise that resolves when the address predictions are set.
         */
        ExtendableObject.setAddressPredictions = async (value) => {
            try {
                const resolvedValue = await ExtendableObject.util.Promise.resolve(value);

                // Decode. The value can come from DOM element as string.
                const decodedValue = (typeof resolvedValue === 'string')
                    ? JSON.parse(resolvedValue) || []
                    : Array.isArray(resolvedValue) ? resolvedValue : [];

                ExtendableObject._addressPredictions = decodedValue;

                // Inform all subscribers about the change.
                const notificationProcesses = [];

                ExtendableObject._subscribers.addressPredictions.forEach((subscriber) => {
                    try {
                        notificationProcesses.push(subscriber.updateDOMValue(JSON.stringify(decodedValue)));
                    } catch (subErr) {
                        console.warn('Failed to update addressPredictions subscriber:', {
                            error: subErr,
                            value: decodedValue
                        });
                    }
                });
                await Promise.all(notificationProcesses);
            } catch (err) {
                console.warn('Error setting addressPredictions:', {
                    error: err,
                    inputValue: value,
                    timestamp: new Date()
                });
                ExtendableObject._addressPredictions = ExtendableObject._addressPredictions || [];
            }
        };

        Object.defineProperty(ExtendableObject, 'addressType', {
            get: () => {
                return ExtendableObject.getAddressType();
            },
            set: (value) => {
                // eslint-disable-next-line no-unused-vars
                const _ = ExtendableObject.setAddressType(value);
            }
        });

        /**
         * Gets the current address type.
         * @returns {string} - The current address type.
         */
        ExtendableObject.getAddressType = () => {
            return ExtendableObject._addressType;
        };

        /**
         * Sets the current address type.
         * @param {string} value - The address type to set.
         * @returns {Promise<void>} - A promise that resolves when the address type is set.
         */
        ExtendableObject.setAddressType = async (value) => {
            try {
                const resolvedValue = await Promise.resolve(value);

                ExtendableObject._addressType = resolvedValue;

                // Inform all subscribers about the change.
                const notificationProcesses = [];

                ExtendableObject._subscribers.addressType.forEach((subscriber) => {
                    try {
                        notificationProcesses.push(
                            subscriber.updateDOMValue(resolvedValue)
                        );
                    } catch (subErr) {
                        console.warn('Failed to update addressType subscriber:', {
                            error: subErr,
                            value: resolvedValue
                        });
                    }
                });
                await Promise.all(notificationProcesses);
            } catch (err) {
                console.warn('Failed to update addressType:', {
                    error: err,
                    value
                });
            }
        };

        // Add getter and setter for fields.
        Object.defineProperty(ExtendableObject, 'addressTimestamp', {
            get: () => {
                return ExtendableObject.getAddressTimestamp();
            },
            set: (value) => {
                // eslint-disable-next-line no-unused-vars
                const _ = ExtendableObject.setAddressTimestamp(value);
            }
        });

        /**
         * Gets the current address timestamp.
         * @returns {number} - The current address timestamp.
         */
        ExtendableObject.getAddressTimestamp = () => {
            return ExtendableObject._addressTimestamp;
        };

        /**
         * Sets the current address timestamp.
         * @param {number} value - The address timestamp to set.
         * @returns {Promise<void>} - A promise that resolves when the address timestamp is set.
         */
        ExtendableObject.setAddressTimestamp = async (value) => {
            try {
                const resolvedValue = await Promise.resolve(value);

                ExtendableObject._addressTimestamp = resolvedValue;

                // Inform all subscribers about the change.
                const notificationProcesses = [];

                ExtendableObject._subscribers.addressTimestamp.forEach((subscriber) => {
                    try {
                        notificationProcesses.push(
                            subscriber.updateDOMValue(resolvedValue)
                        );
                    } catch (subErr) {
                        console.warn('Failed to update addressTimestamp subscriber:', {
                            error: subErr,
                            value: resolvedValue
                        });
                    }
                });
                await Promise.all(notificationProcesses);
            } catch (err) {
                console.warn('Failed to update addressTimestamp:', {
                    error: err,
                    value
                });
            }
        };

        // Add getter and setter for fields.
        Object.defineProperty(ExtendableObject, 'addressPredictionsIndex', {
            get: () => {
                return ExtendableObject.getAddressPredictionsIndex();
            },
            set: (value) => {
                // eslint-disable-next-line no-unused-vars
                const _ = ExtendableObject.setAddressPredictionsIndex(value);
            }
        });

        /**
         * Gets the current address predictions index.
         * @returns {number} - The current address predictions index.
         */
        ExtendableObject.getAddressPredictionsIndex = () => {
            return ExtendableObject._addressPredictionsIndex;
        };

        /**
         * Sets the current address predictions index.
         * @param {number|string} value - The address predictions index to set. Can be a number or a string that can be parsed as a number.
         * @returns {Promise<void>} - A promise that resolves when the address predictions index is set.
         */
        ExtendableObject.setAddressPredictionsIndex = async (value) => {
            try {
                const resolvedValue = await ExtendableObject.util.Promise.resolve(value);
                const newValue = parseInt(resolvedValue, 10); // Ensure it's parsed as base-10 integer

                if (ExtendableObject._addressPredictionsIndex !== newValue) {
                    ExtendableObject._addressPredictionsIndex = newValue;

                    // DOM Update block removed, to prevent race conditions
                }
            } catch (err) {
                console.warn('Error setting addressPredictionsIndex:', {
                    error: err,
                    value
                });
            }
        };
    },

    registerEventCallbacks: (ExtendableObject) => {
        /**
         * Creates an address change event handler for a subscriber.
         * @param {Object} subscriber - The subscriber object containing the value to set.
         * @returns {Function} - An event handler function that updates the address.
         */
        ExtendableObject.cb.addressChange = (subscriber) => {
            return (e) => {
                ExtendableObject.address = subscriber.value;
            };
        };

        /**
         * Creates an address status change event handler for a subscriber.
         * @param {Object} subscriber - The subscriber object containing the value to set.
         * @returns {Function} - An event handler function that updates the address status.
         */
        ExtendableObject.cb.addressStatusChange = (subscriber) => {
            return (e) => {
                ExtendableObject.addressStatus = subscriber.value;
            };
        };

        /**
         * Creates an address predictions index change event handler for a subscriber.
         * @param {Object} subscriber - The subscriber object containing the value to set.
         * @returns {Function} - An event handler function that updates the address predictions index.
         */
        ExtendableObject.cb.addressPredictionsIndexChange = (subscriber) => {
            return (e) => {
                ExtendableObject.addressPredictionsIndex = subscriber.value;
            };
        };
    },

    /**
     * Registers utility functions for the AddressExtension.
     * @param {Object} ExtendableObject - The object to extend with utility methods.
     */
    registerUtilities: (ExtendableObject) => {
        /**
         * Removes status indications from all address fields.
         */
        ExtendableObject.util.removeStatusIndication = () => {
            ExtendableObject.util.indicateStatuscodes(
                []
            );
        };

        /**
         * Invalidates address metadata and marks the address as dirty.
         */
        ExtendableObject.util.invalidateAddressMeta = () => {
            ExtendableObject.addressStatus = [];
            ExtendableObject.addressPredictions = [];
            ExtendableObject.util.removeStatusIndication();
            ExtendableObject.util.markAddressDirty();
        };

        /**
         * Checks if the address check process is finished.
         * @returns {boolean} - True if the address check is finished, false otherwise.
         */
        ExtendableObject.util.isAddressCheckFinished = () => {
            const validStatuses = ['address_selected_by_customer', 'address_selected_automatically'];

            return validStatuses.some(status => ExtendableObject._addressStatus.includes(status));
        };

        /**
         * Marks the address as dirty, indicating it needs validation.
         */
        ExtendableObject.util.markAddressDirty = () => {
            ExtendableObject._changed = true;
            ExtendableObject.forms.forEach((form) => {
                form.setAttribute('endereco-form-needs-validation', true);
            });
        };

        /**
         * Initiates an address check process, utilizing caching if available.
         * @param {...any} args - Additional arguments passed to the address check process.
         * @returns {Promise} - A promise representing the address check process.
         */
        ExtendableObject.util.checkAddress = (...args) => {
            const integrator = window.EnderecoIntegrator;
            const processLevel = integrator.getProcessLevel();
            const address = ExtendableObject.address;
            const key = [
                ExtendableObject.id,
                generateAddressCacheKey(address)
            ].join('--');

            // Is it already cached?
            if (integrator.processQueue.has(key)) {
                return integrator.processQueue.get(key);
            }

            // We first set the current level to the process via key
            // Then start the process (which creates a promise aka running process)
            // Then enqueuing the promise (questionable data structure, should probably work more with keys) or
            // we should move the start-up of the process inside enqueue but still return the promise
            integrator.processQueue.setLevelToProcess(key, processLevel);
            const promise = ExtendableObject.util.processAddressCheck(...args);

            integrator.processQueue.enqueue(key, promise);

            // When finished, remove from queue
            promise.finally(() => {
                integrator.processQueue.delete(key);
            });

            return promise;
        };

        /**
         * Determines the type of user feedback required based on address check results.
         * @param {Object} address - The original address object.
         * @param {Array} predictions - An array of address predictions.
         * @param {string[]} statuscodes - An array of status codes from the address check.
         * @returns {Promise|undefined} - A promise for user feedback if needed, undefined otherwise.
         */
        ExtendableObject.util.getUserFeedback = (address, predictions, statuscodes) => {
            // Case when there are multiple predictions
            const isExpectedToHavePredictions = statuscodes.includes('address_multiple_variants') ||
                statuscodes.includes('address_needs_correction');

            if (predictions.length > 0 && isExpectedToHavePredictions) {
                return ExtendableObject.util.getPredictionsAndMetaFeedback(
                    address,
                    predictions,
                    statuscodes
                );
            }

            // Case when there are no predictions
            // predictions.length === 0 is fallback for older implementation of housenumber not found
            if (statuscodes.includes('address_not_found') || predictions.length === 0) {
                return ExtendableObject.util.getOnlyMetaFeedback(
                    address,
                    predictions,
                    statuscodes
                );
            }
        };

        /**
         * Retrieves only meta feedback for an address without predictions.
         * @param {Object} originalAddress - The original address object.
         * @param {Array} predictions - An array of address predictions (expected to be empty).
         * @param {string[]} statuscodes - An array of status codes from the address check.
         * @returns {Promise<Object>} - A promise resolving to an object with user feedback details.
         */
        ExtendableObject.util.getOnlyMetaFeedback = async (originalAddress, predictions, statuscodes) => {
            // Increase counter to kind of show, that we have a modal here.
            window.EnderecoIntegrator.popupQueue++;
            window.EnderecoIntegrator.enderecoPopupQueue++;

            try {
                await ExtendableObject.waitForPopupAreaToBeFree();

                // Is the original address and the address used for address check still the same?
                if (generateAddressCacheKey(originalAddress) !== generateAddressCacheKey(ExtendableObject.address)) {
                    window.EnderecoIntegrator.popupQueue--;
                    window.EnderecoIntegrator.enderecoPopupQueue--;

                    return;
                }

                // Prepare main address.
                // TODO: replace button then replace button classes.
                // Security: Create escaped copy of original address, then preprocess
                const escapedOriginalAddress = ExtendableObject.util.escapeAddress(originalAddress);
                const preprocessedOriginalAddress = ExtendableObject.util.preprocessAddressParts(escapedOriginalAddress, statuscodes);
                const mainAddressHtml = ExtendableObject.util.formatAddress(
                    preprocessedOriginalAddress,
                    statuscodes,
                    {
                        forceCountryDisplay: true,
                        useHtml: true,
                        countryCodeForTemplate: originalAddress.countryCode
                    }
                );
                const editButtonHTML = ExtendableObject.config.templates.buttonEditAddress.replace('{{{buttonClasses}}}', ExtendableObject.config.templates.primaryButtonClasses);
                const confirmButtonHTML = ExtendableObject.config.templates.buttonConfirmAddress.replace('{{{buttonClasses}}}', ExtendableObject.config.templates.secondaryButtonClasses);

                const errorResolution = generateAddressValidationErrors(ExtendableObject, statuscodes);

                const modalHTML = ExtendableObject.util.Mustache.render(
                    ExtendableObject.config.templates.addressNoPredictionWrapper
                        .replace('{{{button}}}', editButtonHTML)
                        .replace('{{{buttonSecondary}}}', confirmButtonHTML)
                    ,
                    {
                        EnderecoAddressObject: ExtendableObject,
                        direction: getComputedStyle(document.querySelector('body')).direction,
                        modalClasses: errorResolution.invalidFields.join(' '),
                        showClose: ExtendableObject.config.ux.allowCloseModal,
                        hasErrors: errorResolution.fieldErrors.length > 0,
                        errors: errorResolution.fieldErrors,
                        showConfirCheckbox: ExtendableObject.config.ux.confirmWithCheckbox,
                        mainAddress: mainAddressHtml,
                        button: ExtendableObject.config.templates.button,
                        title: ExtendableObject.config.texts.popupHeadlines[ExtendableObject.addressType]
                    }
                );

                let targetElement = ExtendableObject.getTargetSelector();
                const insertPosition = ExtendableObject.getInsertPosition();

                if (!document.querySelector(targetElement)) { targetElement = 'body'; }

                document.querySelector(targetElement).insertAdjacentHTML(insertPosition, modalHTML);
                document.querySelector('body').classList.add('endereco-no-scroll');

                ExtendableObject.onAfterModalRendered.forEach(function (cb) {
                    cb(ExtendableObject);
                });

                const modalElement = document.querySelector('[endereco-popup]');

                return new Promise((resolve) => {
                    setupFocusTrap(ExtendableObject, modalElement);
                    attachModalCloseHandlers(ExtendableObject, modalElement, () => {
                        resolve({
                            userHasEditingIntent: true,
                            userConfirmedSelection: false,
                            selectedAddress: originalAddress
                        });
                    });
                    attachEditAddressHandlers(ExtendableObject, modalElement, () => {
                        resolve({
                            userHasEditingIntent: true,
                            userConfirmedSelection: false,
                            selectedAddress: originalAddress
                        });
                    });
                    attachConfirmationCheckboxHandlers(ExtendableObject, modalElement);
                    attachConfirmAddressHandlers(ExtendableObject, modalElement, () => {
                        resolve({
                            userHasEditingIntent: false,
                            userConfirmedSelection: true,
                            selectedAddress: originalAddress
                        });
                    });
                });
            } catch (error) {
                // Handle any errors that occur during the async operations
                console.warn('Error in getOnlyMetaFeedback:', error);
                window.EnderecoIntegrator.popupQueue--;
                window.EnderecoIntegrator.enderecoPopupQueue--;

                return new Promise((resolve) => {
                    // Decide how to resolve the promise in case of error
                    resolve({
                        userHasEditingIntent: false,
                        userConfirmedSelection: false,
                        selectedAddress: originalAddress,
                        error
                    });
                });
            }
        };

        /**
         * Retrieves predictions and meta feedback for an address with multiple variants.
         * @param {Object} originalAddress - The original address object.
         * @param {Array} predictions - An array of address predictions.
         * @param {string[]} statuscodes - An array of status codes from the address check.
         * @returns {Promise<Object>} - A promise resolving to an object with user feedback details.
         */
        ExtendableObject.util.getPredictionsAndMetaFeedback = async (originalAddress, predictions, statuscodes) => {
            // Increase counter to kind of show, that we have a modal here.
            window.EnderecoIntegrator.popupQueue++;
            window.EnderecoIntegrator.enderecoPopupQueue++;

            await ExtendableObject.waitForPopupAreaToBeFree();

            // Is the original address and the address used for address check still the same?
            if (generateAddressCacheKey(originalAddress) !== generateAddressCacheKey(ExtendableObject.address)) {
                window.EnderecoIntegrator.popupQueue--;
                window.EnderecoIntegrator.enderecoPopupQueue--;

                return;
            }

            // Integrity check for the case, when input address has the subdivisionCode and output doesn't
            const addressToProcess = { ...originalAddress };

            if (
                predictions.length > 0 &&
                addressToProcess.subdivisionCode !== undefined &&
                predictions[0].subdivisionCode === undefined
            ) {
                delete addressToProcess.subdivisionCode;
            }

            // Popup needed.
            // Security: Create escaped copy of original address, then preprocess
            const escapedOriginalAddress = ExtendableObject.util.escapeAddress(addressToProcess);
            const preprocessedOriginalAddress = ExtendableObject.util.preprocessAddressParts(escapedOriginalAddress, statuscodes);

            const escapedFirstPrediction = ExtendableObject.util.escapeAddress(predictions[0]);
            const preprocessedFirstPrediction = ExtendableObject.util.preprocessAddressParts(escapedFirstPrediction, statuscodes);

            // Calculate main address diff - show neutral and removed parts (what was in original)
            const mainAddressDiffed = ExtendableObject.util.diffAddressParts(
                preprocessedOriginalAddress,
                preprocessedFirstPrediction,
                DIFF_NEUTRAL | DIFF_REMOVE
            );
            const mainAddressDiffHtml = ExtendableObject.util.formatAddress(
                mainAddressDiffed,
                statuscodes,
                {
                    countryCodeForTemplate: originalAddress.countryCode
                }
            );

            // Prepare predictions.
            const processedPredictions = [];

            predictions.forEach((addressPrediction) => {
                // Security: Create escaped copy of prediction, then preprocess
                const escapedPrediction = ExtendableObject.util.escapeAddress(addressPrediction);
                const preprocessedPrediction = ExtendableObject.util.preprocessAddressParts(escapedPrediction, statuscodes);

                // Calculate diff - show neutral and added parts (what will be in prediction)
                const addressDiffed = ExtendableObject.util.diffAddressParts(
                    preprocessedOriginalAddress,
                    preprocessedPrediction,
                    DIFF_NEUTRAL | DIFF_ADD
                );
                const addressDiff = ExtendableObject.util.formatAddress(
                    addressDiffed,
                    statuscodes,
                    { countryCodeForTemplate: originalAddress.countryCode });

                processedPredictions.push({
                    addressDiff
                });
            });

            // Render wrapper.
            let indexCounter = 0;
            const useButtonHTML = ExtendableObject.config.templates.button.replace('{{{buttonClasses}}}', ExtendableObject.config.templates.primaryButtonClasses);
            const predictionsWrapperHtml = ExtendableObject.util.Mustache.render(
                ExtendableObject.config.templates.addressPredictionsPopupWrapper.replace('{{{button}}}', useButtonHTML),
                {
                    EnderecoAddressObject: ExtendableObject,
                    direction: getComputedStyle(document.querySelector('body')).direction,
                    predictions: processedPredictions,
                    mainAddress: mainAddressDiffHtml,
                    showClose: ExtendableObject.config.ux.allowCloseModal,
                    showConfirCheckbox: ExtendableObject.config.ux.confirmWithCheckbox,
                    button: ExtendableObject.config.templates.button,
                    title: ExtendableObject.config.texts.popupHeadlines[ExtendableObject.addressType],
                    index: function () {
                        return indexCounter;
                    },
                    loopUp: function () {
                        indexCounter++;

                        return '';
                    }
                }
            );

            let targetElement = ExtendableObject.getTargetSelector();
            const insertPosition = ExtendableObject.getInsertPosition();

            if (!document.querySelector(targetElement)) { targetElement = 'body'; }

            document.querySelector(targetElement).insertAdjacentHTML(insertPosition, predictionsWrapperHtml);
            document.querySelector('body').classList.add('endereco-no-scroll');

            ExtendableObject.onAfterModalRendered.forEach(function (cb) {
                cb(ExtendableObject);
            });

            const modalElement = document.querySelector('[endereco-popup]');

            return new Promise((resolve) => {
                setupFocusTrap(ExtendableObject, modalElement);
                attachModalCloseHandlers(ExtendableObject, modalElement, () => {
                    resolve({
                        userHasEditingIntent: true,
                        userConfirmedSelection: false,
                        selectedAddress: originalAddress
                    });
                });

                attachEditAddressHandlers(ExtendableObject, modalElement, () => {
                    resolve({
                        userHasEditingIntent: true,
                        userConfirmedSelection: false,
                        selectedAddress: originalAddress
                    });
                });

                attachSelectionHandlers(ExtendableObject, modalElement, (selectedIndex) => {
                    resolve({
                        userHasEditingIntent: false,
                        userConfirmedSelection: true,
                        selectedAddress: (selectedIndex >= 0) ? predictions[selectedIndex] : originalAddress
                    });
                });
                attachPredictionsRadioHandlers(ExtendableObject, modalElement);
                attachConfirmationCheckboxHandlers(ExtendableObject, modalElement);
            });
        };

        /**
         * Processes an address check, handling automatic corrections and user feedback.
         * @returns {Promise<Object>} - A promise resolving to the final result of the address check.
         */
        ExtendableObject.util.processAddressCheck = async () => {
            const addressCheckRoutineCounter = ++ExtendableObject._addressCheckRoutineCounter;
            const allowedToAutocorrect = addressCheckRoutineCounter === 1;
            const addressToCheck = ExtendableObject.getAddress();
            const existingStatusCodes = ExtendableObject.getAddressStatus();
            const existingPredictions = ExtendableObject.getAddressPredictions();
            const processKey = [
                ExtendableObject.id,
                generateAddressCacheKey(addressToCheck)
            ].join('--');

            await waitForTurn(processKey);

            const finalResult = {
                address: addressToCheck,
                addressStatus: existingStatusCodes,
                addressPredictions: existingPredictions,
                sourceOfAddress: 'unverified_user_input',
                processStatus: 'started'
            };

            if (existingStatusCodes.includes('address_selected_by_customer')) {
                finalResult.sourceOfAddress = 'confirmed_user_selection';
                finalResult.processStatus = 'skipped';
                await ExtendableObject.util.indicateStatuscodes(
                    finalResult.addressStatus
                );

                return finalResult;
            }

            if (existingStatusCodes.includes('address_selected_automatically')) {
                finalResult.sourceOfAddress = 'automatic_copy_from_correction';
                finalResult.processStatus = 'skipped';
                await ExtendableObject.util.indicateStatuscodes(
                    finalResult.addressStatus
                );

                return finalResult;
            }

            // Get meta
            const { originalAddress, statuses, predictions, requestStatus } = await ExtendableObject.util.getAddressMeta(addressToCheck);

            if (requestStatus !== 'success') {
                finalResult.processStatus = 'network_error';

                return finalResult;
            }

            if (generateAddressCacheKey(addressToCheck) !== generateAddressCacheKey(ExtendableObject.address)) {
                finalResult.processStatus = 'invalid_result';

                return finalResult;
            }

            if (ExtendableObject.anyMissing() || ExtendableObject.areEssentialsDisabled()) {
                finalResult.processStatus = 'invalid_result';

                return finalResult;
            }

            const autocorrectNeeded = allowedToAutocorrect &&
                (isAutomaticCorrection(statuses) || isAddressCorrect(statuses));
            const manualActionNeeded = (isPredictionOrMetaFeedbackNeeded(statuses, predictions) ||
                isOnlyMetaFeedbackNeeded(statuses, predictions)) && !autocorrectNeeded;

            if (autocorrectNeeded) {
                const autoCorrectionAddress = predictions[0];

                const {
                    originalAddress: finalAddress,
                    statuses: finalStatuses,
                    predictions: finalPredictions,
                    requestStatus: finalRequestStatus
                } = await ExtendableObject.util.getAddressMeta(autoCorrectionAddress);

                if (finalRequestStatus !== 'success') {
                    finalResult.processStatus = 'network_error';

                    return finalResult;
                }

                if (generateAddressCacheKey(addressToCheck) !== generateAddressCacheKey(ExtendableObject.address)) {
                    finalResult.processStatus = 'invalid_result';

                    return finalResult;
                }

                if (ExtendableObject.anyMissing() || ExtendableObject.areEssentialsDisabled()) {
                    finalResult.processStatus = 'invalid_result';

                    return finalResult;
                }

                finalResult.address = finalAddress;
                finalResult.addressStatus = [...finalStatuses, 'address_selected_automatically'];
                finalResult.addressPredictions = finalPredictions;
                finalResult.sourceOfAddress = 'automatic_copy_from_correction';
                finalResult.processStatus = 'finished';
            }

            if (manualActionNeeded) {
                const userFeedback = await ExtendableObject.util.getUserFeedback(originalAddress, predictions, statuses);

                const {
                    originalAddress: finalAddress,
                    statuses: finalStatuses,
                    predictions: finalPredictions,
                    requestStatus: finalRequestStatus
                } = await ExtendableObject.util.getAddressMeta(userFeedback.selectedAddress);

                if (finalRequestStatus !== 'success') {
                    finalResult.processStatus = 'network_error';

                    return finalResult;
                }

                if (generateAddressCacheKey(addressToCheck) !== generateAddressCacheKey(ExtendableObject.address)) {
                    finalResult.processStatus = 'invalid_result';

                    return finalResult;
                }

                if (ExtendableObject.anyMissing() || ExtendableObject.areEssentialsDisabled()) {
                    finalResult.processStatus = 'invalid_result';

                    return finalResult;
                }

                if (userFeedback.userConfirmedSelection) {
                    finalResult.address = finalAddress;
                    finalResult.addressStatus = [...finalStatuses, 'address_selected_by_customer'];
                    finalResult.addressPredictions = finalPredictions;
                    finalResult.sourceOfAddress = 'confirmed_user_selection';
                    finalResult.processStatus = 'finished';
                }
            }

            if (!autocorrectNeeded && !manualActionNeeded) {
                if (generateAddressCacheKey(addressToCheck) !== generateAddressCacheKey(ExtendableObject.address)) {
                    finalResult.processStatus = 'invalid_result';

                    return finalResult;
                }

                if (ExtendableObject.anyMissing() || ExtendableObject.areEssentialsDisabled()) {
                    finalResult.processStatus = 'invalid_result';

                    return finalResult;
                }

                finalResult.addressStatus = [...statuses, 'address_selected_by_customer'];
                finalResult.addressPredictions = predictions;
                finalResult.sourceOfAddress = 'confirmed_user_selection';
                finalResult.processStatus = 'finished';
            }

            ExtendableObject._isIntegrityOperationSynchronous = true;
            await onBeforeResultPersisted(ExtendableObject, finalResult);
            try {
                await Promise.all([
                    ExtendableObject.setAddress(finalResult.address),
                    ExtendableObject.setAddressStatus(finalResult.addressStatus),
                    ExtendableObject.setAddressPredictions(finalResult.addressPredictions),
                    ExtendableObject.setAddressTimestamp(Math.floor(Date.now() / MILLISECONDS_IN_SECOND))
                ]);
            } catch (err) {
                // This will catch if any of the promises reject
                console.error('Failed updating the state in processAddressCheck', {
                    error: err
                });
            }
            await onAfterResultPersisted(ExtendableObject, finalResult);
            ExtendableObject._isIntegrityOperationSynchronous = false;

            // Display status codes
            await ExtendableObject.util.indicateStatuscodes(
                finalResult.addressStatus
            );

            return finalResult;
        };

        /**
         * Checks if the current intent is set to 'review'.
         * @returns {boolean} - True if the intent is 'review', false otherwise.
         */
        ExtendableObject.util.isReviewIntent = () => {
            return ExtendableObject.getIntent() === 'review';
        };

        /**
         * Preheats the address check cache with current address data if status exists.
         */
        ExtendableObject.util.preheatCache = () => {
            // Initialize blur cache with current address to prevent unnecessary blur checks on page load
            ExtendableObject._lastBlurCheckedAddress = { ...ExtendableObject.address };

            if (ExtendableObject.addressStatus.length === 0) {
                return;
            }

            const cacheKey = generateAddressCacheKey(ExtendableObject.address);

            const predictions = [...ExtendableObject.addressPredictions];

            const normalizedPredictions = predictions.map(addressPrediction => {
                const normalizedPrediction = { ...addressPrediction };

                // Fix for outdated format in the DB. Its might not contain the "streetFull" in the predictions
                if (Object.prototype.hasOwnProperty.call(ExtendableObject.address, 'countryCode')) {
                    normalizedPrediction.countryCode = addressPrediction.countryCode.toUpperCase();
                }

                if (Object.prototype.hasOwnProperty.call(ExtendableObject.address, 'streetFull')) {
                    // If prediction has streetFull, use it directly
                    if (Object.prototype.hasOwnProperty.call(addressPrediction, 'streetFull')) {
                        normalizedPrediction.streetFull = addressPrediction.streetFull;
                    } else {
                        // Otherwise, format it from other fields
                        normalizedPrediction.streetFull = ExtendableObject.util.formatStreetFull(
                            addressPrediction
                        );
                    }
                }

                return normalizedPrediction;
            });

            ExtendableObject.addressCheckCache.cachedResults[cacheKey] = {
                originalAddress: { ...ExtendableObject.address },
                predictions: normalizedPredictions,
                statuses: [...ExtendableObject.addressStatus],
                requestStatus: 'success'
            };
        };

        /**
         * Updates the status indications for address fields based on provided status codes.
         * @param {string[]} statuses - An array of status codes to indicate.
         */
        ExtendableObject.util.indicateStatuscodes = (statuses) => {
            // If statuses is empty, assign empty arrays to all field statuses
            if (!statuses || statuses.length === 0) {
                ExtendableObject.countryCodeStatus = [];
                ExtendableObject.subdivisionCodeStatus = [];
                ExtendableObject.postalCodeStatus = [];
                ExtendableObject.localityStatus = [];
                ExtendableObject.streetFullStatus = [];
                ExtendableObject.streetNameStatus = [];
                ExtendableObject.buildingNumberStatus = [];
                ExtendableObject.additionalInfoStatus = [];

                return;
            }

            // Country code
            const countryCodeCorrect = statuses.includes('address_correct') || statuses.includes('country_code_correct');
            const countryCodeFaulty = statuses.includes('country_code_not_found') || statuses.includes('country_code_needs_correction');
            const countryCodeStatus = countryCodeCorrect ? ['field_correct'] : ['field_not_correct'];

            // Subdivision code
            const subdivisionCodeCorrect = statuses.includes('address_correct') || statuses.includes('subdivision_code_correct');
            const subdivisionCodeFaulty = statuses.includes('subdivision_code_not_found') || statuses.includes('subdivision_code_needs_correction');
            const subdivisionCodeStatus = subdivisionCodeCorrect ? ['field_correct'] : ['field_not_correct'];

            // Postal code
            const postalCodeCorrect = statuses.includes('address_correct') || statuses.includes('postal_code_correct');
            const postalCodeFaulty = statuses.includes('postal_code_not_found') || statuses.includes('postal_code_needs_correction');
            const postalCodeStatus = postalCodeCorrect ? ['field_correct'] : ['field_not_correct'];

            // Locality (cityName)
            const localityCorrect = statuses.includes('address_correct') || statuses.includes('locality_correct');
            const localityFaulty = statuses.includes('locality_not_found') || statuses.includes('locality_needs_correction');
            const localityStatus = localityCorrect ? ['field_correct'] : ['field_not_correct'];

            // Street name
            const streetNameCorrect = statuses.includes('address_correct') || statuses.includes('street_name_correct');
            const streetNameFaulty = statuses.includes('street_name_not_found') || statuses.includes('street_name_needs_correction');
            const streetNameStatus = streetNameCorrect ? ['field_correct'] : ['field_not_correct'];

            // Building number
            const buildingNumberCorrect = statuses.includes('address_correct') || statuses.includes('building_number_correct');
            const buildingNumberFaulty = statuses.includes('building_number_not_found') || statuses.includes('building_number_is_missing');
            const buildingNumberStatus = buildingNumberCorrect ? ['field_correct'] : ['field_not_correct'];

            // Additional info
            const additionalInfoCorrect = statuses.includes('address_correct') || statuses.includes('additional_info_correct');
            const additionalInfoFaulty = statuses.includes('additional_info_not_found') || statuses.includes('additional_info_needs_correction') || statuses.includes('additional_info_is_missing');
            const additionalInfoStatus = additionalInfoCorrect ? ['field_correct'] : ['field_not_correct'];

            // Street full - Special case
            const streetFullCorrect = statuses.includes('address_correct') ||
                statuses.includes('street_full_correct') ||
                (statuses.includes('street_name_correct') && statuses.includes('building_number_correct'));
            const streetFullFaulty = statuses.includes('street_full_not_found') ||
                statuses.includes('street_name_not_found') ||
                statuses.includes('building_number_not_found') ||
                statuses.includes('street_full_needs_correction') ||
                statuses.includes('street_name_needs_correction') ||
                statuses.includes('building_number_needs_correction');
            const streetFullStatus = streetFullCorrect ? ['field_correct'] : ['field_not_correct'];

            // Set the status for each field, show error status even when field is empty if there's an error
            ExtendableObject.countryCodeStatus = ExtendableObject.countryCode
                ? countryCodeStatus
                : (countryCodeFaulty ? ['field_not_correct'] : []);
            ExtendableObject.subdivisionCodeStatus = ExtendableObject.subdivisionCode
                ? subdivisionCodeStatus
                : (subdivisionCodeFaulty ? ['field_not_correct'] : []);
            ExtendableObject.postalCodeStatus = ExtendableObject.postalCode
                ? postalCodeStatus
                : (postalCodeFaulty ? ['field_not_correct'] : []);
            ExtendableObject.localityStatus = ExtendableObject.locality
                ? localityStatus
                : (localityFaulty ? ['field_not_correct'] : []);
            ExtendableObject.streetFullStatus = ExtendableObject.streetFull
                ? streetFullStatus
                : (streetFullFaulty ? ['field_not_correct'] : []);
            ExtendableObject.streetNameStatus = ExtendableObject.streetName
                ? streetNameStatus
                : (streetNameFaulty ? ['field_not_correct'] : []);
            ExtendableObject.buildingNumberStatus = ExtendableObject.buildingNumber
                ? buildingNumberStatus
                : (buildingNumberFaulty ? ['field_not_correct'] : []);
            ExtendableObject.additionalInfoStatus = ExtendableObject.additionalInfo
                ? additionalInfoStatus
                : (additionalInfoFaulty ? ['field_not_correct'] : []);
        };

        /**
         * Checks if a field has an active subscriber.
         * @param {string} fieldName - The name of the field to check.
         * @returns {boolean} - True if the field has an active subscriber, false otherwise.
         */
        ExtendableObject.util.hasSubscribedField = (fieldName) => {
            const subscribers = ExtendableObject._subscribers[fieldName] || [];
            const hasActiveSubscriber = subscribers.some((listener) => {
                const domElementExists = listener.object &&
                    !listener.object.disabled &&
                    listener.object.isConnected;

                return domElementExists && window.EnderecoIntegrator.hasActiveSubscriber(fieldName, listener.object, ExtendableObject);
            });

            return hasActiveSubscriber;
        };

        /**
         * Waits until the popup area is free of existing popups.
         * @returns {Promise<void>} - A promise that resolves when the popup area is free.
         */
        ExtendableObject.waitForPopupAreaToBeFree = async () => {
            while (true) {
                let isAreaFree = !document.querySelector('[endereco-popup]');

                // Check if the popup area is free
                isAreaFree = isAreaFree && await window.EnderecoIntegrator.isPopupAreaFree(ExtendableObject);

                if (isAreaFree) {
                    break;
                }

                await sleep(WAIT_FOR_TIME);
            }
        };

        /**
         * Waits until all popups are closed.
         * @returns {Promise<void>} - A promise that resolves when all popups are closed.
         */
        ExtendableObject.waitForAllPopupsToClose = async () => {
            while (true) {
                if (
                    undefined !== window.EnderecoIntegrator &&
                    undefined !== window.EnderecoIntegrator.popupQueue &&
                    window.EnderecoIntegrator.popupQueue === 0
                ) {
                    break;
                }

                await sleep(WAIT_FOR_TIME);
            }
        };

        /**
         * Determines if the address should be checked based on required fields and form validity.
         * @returns {boolean} - True if the address should be checked, false otherwise.
         */
        ExtendableObject.util.shouldBeChecked = () => {
            if (
                !ExtendableObject.countryCode ||
                (!ExtendableObject.streetName && !ExtendableObject.streetFull) ||
                !ExtendableObject.postalCode ||
                !ExtendableObject.locality
            ) {
                return false;
            }

            if (!window.EnderecoIntegrator.isAddressFormStillValid(ExtendableObject)) {
                return false;
            }

            return true;
        };

        /**
         * Preprocesses an address object for rendering by adding derived fields
         * like countryName, subdivisionName, and placeholders for missing values.
         *
         * @param {Object} address - The address object to preprocess.
         * @param {string[]} statuscodes - An array of status codes affecting preprocessing.
         * @returns {Object} - A new address object with derived fields added.
         */
        ExtendableObject.util.preprocessAddressParts = (address, statuscodes) => {
            const preparedData = { ...address };

            // Enrich address with countryName
            if (Boolean(window.EnderecoIntegrator.countryCodeToNameMapping) &&
                Boolean(window.EnderecoIntegrator.countryCodeToNameMapping[address.countryCode.toUpperCase()])
            ) {
                const textAreaForCountryName = document.createElement('textarea');

                textAreaForCountryName.innerHTML =
                    window.EnderecoIntegrator.countryCodeToNameMapping[address.countryCode.toUpperCase()];
                preparedData.countryName = textAreaForCountryName.value.toUpperCase();
            } else {
                preparedData.countryName = address.countryCode.toUpperCase();
            }

            if (
                Object.prototype.hasOwnProperty.call(address, 'subdivisionCode') &&
                typeof address.subdivisionCode === 'string'
            ) {
                if (Boolean(window.EnderecoIntegrator.subdivisionCodeToNameMapping) &&
                    Boolean(window.EnderecoIntegrator.subdivisionCodeToNameMapping[address.subdivisionCode.toUpperCase()])
                ) {
                    const textAreaForSubdivision = document.createElement('textarea');

                    textAreaForSubdivision.innerHTML =
                        window.EnderecoIntegrator.subdivisionCodeToNameMapping[address.subdivisionCode.toUpperCase()];
                    preparedData.subdivisionName = textAreaForSubdivision.value;
                } else {
                    if (address.subdivisionCode.toUpperCase() !== '') {
                        preparedData.subdivisionName = address.subdivisionCode.toUpperCase().split('-')[1];
                    } else {
                        preparedData.subdivisionName = '&nbsp;';
                    }
                }
            }

            if (!address.buildingNumber || !(address.buildingNumber.trim())) {
                preparedData.buildingNumber = '&nbsp;';
            }

            if (statuscodes.includes('additional_info_is_missing')) {
                preparedData.additionalInfo = '&nbsp;';
            }

            // Workaround to display missing house number
            if (statuscodes.includes('building_number_is_missing') &&
                !Object.prototype.hasOwnProperty.call(address, 'streetName')
            ) {
                preparedData.streetName = preparedData.streetFull;
                delete preparedData.streetFull;
            }

            return preparedData;
        };

        /**
         * Formats an address into a string representation.
         * @param {Object} address - The address object to format.
         * @param {string[]} statuscodes - An array of status codes affecting formatting.
         * @param {Object} [options={}] - Formatting options.
         * @param {boolean} [options.forceCountryDisplay=false] - Whether to force display of the country.
         * @param {boolean} [options.useHtml=false] - Whether to use HTML in the formatted output.
         * @param {string} [options.countryCodeForTemplate=null] - Country code for template selection (use when address contains diff spans).
         * @returns {string} - The formatted address string.
         */
        ExtendableObject.util.formatAddress = (address, statuscodes, options = {}) => {
            const {
                forceCountryDisplay = false,
                useHtml = false,
                countryCodeForTemplate = null
            } = options;

            // If countryCodeForTemplate is provided, address is already preprocessed (contains diff spans)
            const preparedData = countryCodeForTemplate
                ? { ...address }
                : ExtendableObject.util.preprocessAddressParts(address, statuscodes);

            const isSubdivisionVisible = ExtendableObject.util.hasSubscribedField('subdivisionCode');

            preparedData.showSubdisivion = (preparedData.subdivisionName !== '&nbsp;') &&
                Object.prototype.hasOwnProperty.call(address, 'subdivisionCode') &&
                typeof address.subdivisionCode === 'string' &&
                (
                    statuscodes.includes('subdivision_code_needs_correction') ||
                    statuscodes.includes('address_multiple_variants')
                ) &&
                isSubdivisionVisible;

            preparedData.useHtml = useHtml;
            preparedData.showCountry = forceCountryDisplay ||
                statuscodes.includes('country_code_needs_correction') ||
                statuscodes.includes('country_code_not_found');

            // Define which template to use
            let useTemplate = 'default';
            const templateCountryCode = countryCodeForTemplate || address.countryCode;

            if (undefined !== ExtendableObject.config.templates.addressFull[templateCountryCode.toLowerCase()]) {
                useTemplate = templateCountryCode.toLowerCase();
            }
            const template = JSON.parse(JSON.stringify(ExtendableObject.config.templates.addressFull[useTemplate]));

            const formattedAddress = ExtendableObject.util.Mustache.render(
                template,
                preparedData
            ).replace(/  +/g, ' ');

            return formattedAddress;
        };

        /**
         * Removes the current popup from the DOM and resets related states.
         */
        ExtendableObject.util.removePopup = () => {
            if (document.querySelector('[endereco-popup]')) {
                document.querySelector('[endereco-popup]').parentNode.removeChild(document.querySelector('[endereco-popup]'));
                document.querySelector('body').classList.remove('endereco-no-scroll');
                ExtendableObject.addressPredictionsIndex = 0;
                window.EnderecoIntegrator.popupQueue--;
                window.EnderecoIntegrator.enderecoPopupQueue--;

                if (ExtendableObject.modalClosed) {
                    ExtendableObject.modalClosed();
                }
            }
        };

        /**
         * Determines if essential address fields are disabled.
         *
         * TODO: clarify the use case for this. As of now its transferred from the old AddressCheck Extension for
         *       eventual backward compatibility.
         *
         * @returns {boolean} True if essential locality and postal code are disabled, false otherwise
         */
        ExtendableObject.areEssentialsDisabled = () => {
            // Check if postal code subscribers exist and are available
            const hasPostalCodeSubscribers = ExtendableObject._subscribers?.postalCode?.length > 0;
            const hasLocalitySubscribers = ExtendableObject._subscribers?.locality?.length > 0;

            // If no subscribers exist for either type, essentials are not disabled
            if (!hasPostalCodeSubscribers && !hasLocalitySubscribers) {
                return false;
            }

            // Check if all postal code subscribers are disabled
            if (hasPostalCodeSubscribers) {
                const allPostalCodesDisabled = !ExtendableObject._subscribers.postalCode
                    .some(subscriber => !subscriber.object.disabled);

                if (allPostalCodesDisabled) {
                    return true; // All postal code DOM objects are disabled, address incomplete
                }
            }

            // Check if all locality subscribers are disabled
            if (hasLocalitySubscribers) {
                const allLocalitiesDisabled = !ExtendableObject._subscribers.locality
                    .some(subscriber => !subscriber.object.disabled);

                return allLocalitiesDisabled; // Return true if all localities are disabled
            }

            // If we reach here, most likely the address is complete.
            return false;
        };

        /**
         * Escapes an address object to prevent XSS. The fields that should be escaped can be overwritten. Not all given fields have to exist in the passed address object.
         *
         * @param {Object} address - The (possibly) unescaped address object.
         * @param {string[]} fieldsToEscape The fields that should be escaped. The default fields are "additionalInfo", "streetFull", "streetName", "buildingNumber", "postalCode", "locality", "countryCode" and "subdivisionCode".
         * @returns {Object} - Returns the escaped address object.
         */
        ExtendableObject.util.escapeAddress = (address, fieldsToEscape = ['additionalInfo', 'streetFull', 'streetName', 'buildingNumber', 'postalCode', 'locality', 'countryCode', 'subdivisionCode']) => {
            const escapedAddress = { ...address };

            fieldsToEscape.forEach(field => {
                if (escapedAddress[field] && ExtendableObject.util.escapeHTML) {
                    escapedAddress[field] = ExtendableObject.util.escapeHTML(escapedAddress[field]);
                }
            });

            return escapedAddress;
        };

        /**
         * Compares two addresses field by field and returns a new address object
         * where each field value contains diff spans for rendering.
         *
         * @param {Object} originalAddress - The original address to compare.
         * @param {Object} comparisonAddress - The address to compare against.
         * @param {number} [mask=DIFF_ALL] - Bitmask to filter which diff parts to include (DIFF_NEUTRAL | DIFF_ADD | DIFF_REMOVE).
         * @returns {Object} - A new address object with field values containing diff spans.
         */
        ExtendableObject.util.diffAddressParts = (originalAddress, comparisonAddress, mask = DIFF_ALL) => {
            const diffedAddress = { ...originalAddress };
            const fieldsToCompare = [
                'additionalInfo',
                'streetFull',
                'streetName',
                'buildingNumber',
                'postalCode',
                'locality',
                'countryName',
                'subdivisionName'
            ];

            fieldsToCompare.forEach(field => {
                if (!Object.prototype.hasOwnProperty.call(originalAddress, field) ||
                    typeof originalAddress[field] !== 'string'
                ) {
                    return;
                }

                const originalValue = originalAddress[field];
                const comparisonValue = Object.prototype.hasOwnProperty.call(comparisonAddress, field)
                    ? (comparisonAddress[field] || '')
                    : '';

                const diff = diffWords(originalValue, comparisonValue, { ignoreCase: false });
                let diffHtml = '';

                diff.forEach((part) => {
                    if (part.added && !(mask & DIFF_ADD)) {
                        return;
                    }
                    if (part.removed && !(mask & DIFF_REMOVE)) {
                        return;
                    }
                    if (!part.added && !part.removed && !(mask & DIFF_NEUTRAL)) {
                        return;
                    }

                    const markClass = part.added
                        ? 'endereco-span--add'
                        : part.removed ? 'endereco-span--remove' : 'endereco-span--neutral';

                    diffHtml += `<span class="${markClass}">${part.value}</span>`;
                });

                diffedAddress[field] = diffHtml;
            });

            return diffedAddress;
        };
    },

    /**
     * Registers API handler functions for the AddressExtension.
     * @param {Object} ExtendableObject - The object to extend with API-related methods.
     */
    registerAPIHandlers: (ExtendableObject) => {
        /**
         * Retrieves metadata for an address by making an API request or using cached results.
         * @param {Object} address - The address object to check, containing fields like countryCode, postalCode, etc.
         * @returns {Promise<Object>} - A promise resolving to an object containing the original address, statuses, predictions, and request status.
         */
        ExtendableObject.util.getAddressMeta = async (address) => {
            const addressToCheck = address;
            const checkResult = {
                originalAddress: addressToCheck,
                statuses: [],
                predictions: [],
                requestStatus: 'started'
            };

            // Check
            const addressCheckRequestIndex = ++ExtendableObject._addressCheckRequestIndex;
            const message = {
                jsonrpc: '2.0',
                id: addressCheckRequestIndex,
                method: 'addressCheck',
                params: {
                    country: address.countryCode,
                    language: ExtendableObject.config.lang,
                    postCode: address.postalCode,
                    cityName: address.locality
                }
            };

            if (Object.prototype.hasOwnProperty.call(addressToCheck, 'subdivisionCode')) {
                message.params.subdivisionCode = addressToCheck.subdivisionCode;
            }

            if (Object.prototype.hasOwnProperty.call(addressToCheck, 'streetName')) {
                message.params.street = addressToCheck.streetName;
            }

            if (Object.prototype.hasOwnProperty.call(addressToCheck, 'buildingNumber')) {
                message.params.houseNumber = addressToCheck.buildingNumber;
            }

            if (Object.prototype.hasOwnProperty.call(addressToCheck, 'streetFull')) {
                message.params.streetFull = addressToCheck.streetFull;
            }

            if (Object.prototype.hasOwnProperty.call(addressToCheck, 'additionalInfo')) {
                message.params.additionalInfo = addressToCheck.additionalInfo;
            }

            const cacheKey = generateAddressCacheKey(addressToCheck);

            const headers = {
                'X-Auth-Key': ExtendableObject.config.apiKey,
                'X-Agent': ExtendableObject.config.agentName,
                'X-Remote-Api-Url': ExtendableObject.config.remoteApiUrl,
                'X-Transaction-Referer': window.location.href,
                'X-Transaction-Id': ExtendableObject.hasLoadedExtension?.('SessionExtension')
                    ? ExtendableObject.sessionId
                    : 'not_required'
            };

            if (!ExtendableObject.addressCheckCache.cachedResults[cacheKey]) {
                try {
                    const EnderecoAPI = ExtendableObject.getEnderecoAPI();

                    if (!EnderecoAPI) {
                        console.warn('EnderecoAPI is not available');
                        checkResult.requestStatus = 'failed';

                        return checkResult;
                    }

                    const result = await EnderecoAPI.sendRequestToAPI(message, headers);

                    if (result?.data?.error?.code === ERROR_EXPIRED_SESSION) {
                        ExtendableObject.util.updateSessionId?.();
                    }

                    if (!result || !result.data || !result.data.result) {
                        console.warn("API didn't return a valid result");
                        checkResult.requestStatus = 'failed';

                        return checkResult;
                    }

                    // If session counter is set, increase it.
                    if (ExtendableObject.hasLoadedExtension('SessionExtension')) {
                        ExtendableObject.sessionCounter++;
                    }

                    const predictions = result.data.result.predictions.map((addressPrediction) => {
                        const normalizedPrediction = {};

                        // If the original address has countryCode, map from prediction's country
                        if (Object.prototype.hasOwnProperty.call(addressToCheck, 'countryCode')) {
                            normalizedPrediction.countryCode = addressPrediction.country.toUpperCase();
                        }

                        if (Object.prototype.hasOwnProperty.call(addressToCheck, 'subdivisionCode')) {
                            normalizedPrediction.subdivisionCode = addressPrediction.subdivisionCode;
                        }

                        if (Object.prototype.hasOwnProperty.call(addressToCheck, 'postalCode')) {
                            normalizedPrediction.postalCode = addressPrediction.postCode;
                        }

                        if (Object.prototype.hasOwnProperty.call(addressToCheck, 'locality')) {
                            normalizedPrediction.locality = addressPrediction.cityName;
                        }

                        if (Object.prototype.hasOwnProperty.call(addressToCheck, 'streetName')) {
                            normalizedPrediction.streetName = addressPrediction.street;
                        }

                        if (Object.prototype.hasOwnProperty.call(addressToCheck, 'buildingNumber')) {
                            normalizedPrediction.buildingNumber = addressPrediction.houseNumber;
                        }

                        if (Object.prototype.hasOwnProperty.call(addressToCheck, 'streetFull')) {
                            // If prediction has streetFull, use it directly
                            if (Object.prototype.hasOwnProperty.call(addressPrediction, 'streetFull')) {
                                normalizedPrediction.streetFull = addressPrediction.streetFull;
                            } else {
                                // Otherwise, format it from other fields
                                normalizedPrediction.streetFull = ExtendableObject.util.formatStreetFull(
                                    {
                                        countryCode: addressPrediction.country,
                                        streetName: addressPrediction.street,
                                        buildingNumber: addressPrediction.houseNumber
                                    }
                                );
                            }
                        }

                        if (Object.prototype.hasOwnProperty.call(addressToCheck, 'additionalInfo')) {
                            normalizedPrediction.additionalInfo = addressPrediction.additionalInfo;
                        }

                        return normalizedPrediction;
                    });

                    checkResult.statuses = result.data.result.status;
                    checkResult.predictions = predictions;

                    checkResult.requestStatus = 'success';
                    ExtendableObject.addressCheckCache.cachedResults[cacheKey] = checkResult;
                } catch (e) {
                    console.warn('AddressCheck against Endereco API failed', e, message);
                    checkResult.requestStatus = 'failed';

                    return checkResult;
                }
            }

            return ExtendableObject.addressCheckCache.cachedResults[cacheKey];
        };
    },

    /**
     * Registers filter callback functions for the AddressExtension.
     * @param {Object} ExtendableObject - The object to extend with filter callbacks.
     */
    registerFilterCallbacks: (ExtendableObject) => {
        /**
         * Creates a filter callback for setting an address, returning a promise that resolves with the address.
         * @param {Object} address - The address object to be set.
         * @returns {Promise<Object>} - A promise that resolves with the provided address object.
         */
        ExtendableObject.cb.setAddress = (address) => {
            return new ExtendableObject.util.Promise(function (resolve, reject) {
                resolve(address);
            });
        };
    },
    registerConfig: (ExtendableObject) => {
        ExtendableObject.config.templates.addressFull = addressFullTemplates;
        ExtendableObject.config.templates.addressPredictionsPopupWrapper = addressPredictionsPopupWrapper;
        ExtendableObject.config.templates.addressNotFoundPopupWrapper = addressNotFoundPopupWrapper;
        ExtendableObject.config.templates.addressNoPredictionWrapper = addressNoPredictionWrapper;

        if (!ExtendableObject.config.templates.button) {
            ExtendableObject.config.templates.button = '<button class="{{{buttonClasses}}}" endereco-use-selection endereco-disabled-until-confirmed tabindex="3">{{{EnderecoAddressObject.config.texts.useSelected}}}</button>';
        }

        if (!ExtendableObject.config.templates.buttonEditAddress) {
            ExtendableObject.config.templates.buttonEditAddress = '<button class="{{{buttonClasses}}}" endereco-edit-address tabindex="2">{{{EnderecoAddressObject.config.texts.editAddress}}}</button>';
        }

        if (!ExtendableObject.config.templates.buttonConfirmAddress) {
            ExtendableObject.config.templates.buttonConfirmAddress = '<button class="{{{buttonClasses}}}" endereco-confirm-address endereco-disabled-until-confirmed tabindex="4">{{{EnderecoAddressObject.config.texts.confirmAddress}}}</button>';
        }
    },
    extend: async (ExtendableObject) => {
        await ExtendableObject.waitForExtension([
            'CountryCodeExtension',
            'PostalCodeExtension',
            'LocalityExtension',
            'StreetNameExtension',
            'BuildingNumberExtension',
            'AdditionalInfoExtension'
        ]);

        await AddressExtension.registerProperties(ExtendableObject);
        await AddressExtension.registerFields(ExtendableObject);
        await AddressExtension.registerConfig(ExtendableObject);
        await AddressExtension.registerEventCallbacks(ExtendableObject);
        await AddressExtension.registerUtilities(ExtendableObject);
        await AddressExtension.registerAPIHandlers(ExtendableObject);
        await AddressExtension.registerFilterCallbacks(ExtendableObject);

        return AddressExtension;
    }
};

export default AddressExtension;
