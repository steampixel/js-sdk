import merge from "lodash.merge";
import EnderecoAddressObject from "./ams";
import EnderecoSubscriber from "./subscriber";
import EnderecoEmailObject from "./emailservices";
import EnderecoPersonObject from "./personservices";
import EnderecoPhoneObject from "./phoneservices";
import 'core-js/fn/promise/finally';

import { attachSubmitListenersToForm } from '../src/helper/form';
import ProcessQueue from '../src/services/ProcessQueue';


const bindFieldsToAddressObject = async (addressObject, fieldSelectors, EnderecoIntegrator) => {
    const autocompletableFields = ['postalCode', 'locality', 'streetName', 'streetFull'];

    for (const [fieldName, selector] of Object.entries(fieldSelectors)) {
        if (selector.trim() === '') {
            continue;
        }

        const elements = document.querySelectorAll(selector);

        if (elements.length === 0) {
            continue;
        }

        const options = {};
        if (autocompletableFields.includes(fieldName) && EnderecoIntegrator.config.useAutocomplete) {
            options.displayAutocompleteDropdown = true;
        }

        if (EnderecoIntegrator.resolvers && EnderecoIntegrator.resolvers[`${fieldName}Write`]) {
            options.writeFilterCb = function(value, subscriber) {
                return EnderecoIntegrator.resolvers[`${fieldName}Write`](value, subscriber);
            };
        }

        if (EnderecoIntegrator.resolvers && EnderecoIntegrator.resolvers[`${fieldName}Read`]) {
            options.readFilterCb = function(value, subscriber) {
                return EnderecoIntegrator.resolvers[`${fieldName}Read`](value, subscriber);
            };
        }

        if (EnderecoIntegrator.resolvers && EnderecoIntegrator.resolvers[`${fieldName}SetValue`]) {
            options.customSetValue = function(subscriber, value) {
                return EnderecoIntegrator.resolvers[`${fieldName}SetValue`](subscriber, value);
            };
        }

        if (EnderecoIntegrator.resolvers && EnderecoIntegrator.resolvers[`${fieldName}GetValue`]) {
            options.customGetValue = function(subscriber) {
                return EnderecoIntegrator.resolvers[`${fieldName}GetValue`](subscriber);
            };
        }

        elements.forEach( (DOMElement) => {
            const subscriber = new EnderecoSubscriber(
                fieldName,
                DOMElement,
                options
            )
            addressObject.addSubscriber(subscriber);

            EnderecoIntegrator.prepareDOMElement(DOMElement, addressObject)
        })
    }
}

/**
 * @function checkSelectValuesAgainstMapping
 * @description Validates the <option> elements within a given <select> element against a provided mapping object.
 * It determines if the select element contains any "valid" options (non-disabled, with a non-empty value)
 * and checks if the values of all such valid options exist as keys within the mapping object.
 *
 * @param {HTMLSelectElement | null | undefined} domElementOfSelect - The <select> DOM element whose options should be checked.
 * The function handles null or undefined input gracefully by returning the default result structure.
 * @param {object} mappingObject - The JavaScript object used as a reference map. The function checks
 * if the `value` attribute of the valid options exists as a key in this object.
 * It expects this to be a non-null object for the mapping check to work correctly.
 *
 * @returns {{
 * hasValidOptions: boolean,
 * allValuesInMapping: boolean,
 * missingValues: string[],
 * allOptionValues: string[]
 * }} An object containing the results of the validation:
 * - `hasValidOptions`: `true` if the select element has at least one option that is not disabled and has a non-empty value; `false` otherwise.
 * - `allValuesInMapping`: `true` if `hasValidOptions` is true AND every valid option's value exists as a key in `mappingObject`; `false` otherwise.
 * - `missingValues`: An array of strings containing the values of valid options that were *not* found as keys in `mappingObject`. Empty if all values are found or if `hasValidOptions` is false.
 * - `allOptionValues`: An array of strings containing the values of *all* valid options found in the select element. Empty if `hasValidOptions` is false.
 */
const checkSelectValuesAgainstMapping = (domElementOfSelect, mappingObject) => {
    // Initialize default return structure
    const result = {
        hasValidOptions: false,
        allValuesInMapping: false,
        missingValues: [],
        allOptionValues: []
    };

    // Check if select element exists
    if (!domElementOfSelect) {
        return result;
    }

    const options = domElementOfSelect.options;
    const optionValues = [];

    // Process all valid options
    for (let i = 0; i < options.length; i++) {
        const option = options[i];
        if (option.value && !option.disabled) {
            result.hasValidOptions = true;
            optionValues.push(option.value);
        }
    }

    // Set allOptionValues regardless of whether options are valid
    result.allOptionValues = optionValues;

    // Find missing values only if we have valid options
    if (result.hasValidOptions) {
        for (const value of optionValues) {
            if (!Object.prototype.hasOwnProperty.call(mappingObject, value)) {
                result.missingValues.push(value);
            }
        }

        result.allValuesInMapping = result.missingValues.length === 0;
    }

    return result;
}

const EnderecoIntegrator = {
    amsFilters: {
        isAddressMetaStillRelevant: []
    },
    processQueue: new ProcessQueue(),
    /**
     * Returns the current process level for queue management.
     * Level 0: Initial processes (billing, shipping address checks)
     * Level 1+: Processes spawned from user interactions (modal submissions)
     * Higher levels can execute without waiting for lower levels.
     *
     * @returns {number} - The current process level (default: 0)
     */
    getProcessLevel: function() {
        // Default implementation returns level 0
        // Can be overridden in custom integrations to return higher levels
        // when processes are spawned from user interactions (e.g., modal submissions)
        return 0;
    },
    popupQueue: 0,
    enderecoPopupQueue: 0,
    ready: false,
    loaded: true,
    themeName: undefined,
    countryMappingUrl: '',
    defaultCountry: 'DE',
    defaultCountrySelect: false,
    billingAutocheck: false,
    shippingAutocheck: false,
    editingIntent: false,
    thirdPartyModals: 0,
    subdivisionMapping: {},
    subdivisionMappingReverse: {},
    countryMapping: {},
    countryMappingReverse: {},
    constructors: {
        "EnderecoAddressObject": EnderecoAddressObject,
        "EnderecoSubscriber": EnderecoSubscriber,
        "EnderecoEmailObject": EnderecoEmailObject,
        "EnderecoPersonObject": EnderecoPersonObject,
        "EnderecoPhoneObject": EnderecoPhoneObject
    },
    globalSpace: {
        reloadPage: function() {
            location.reload();
        }
    },
    prepareDOMElement: (DOMElement, addressObject) => {
        // To be overridden in system specific implementation.
    },
    isAddressFormStillValid: (EAO) => {
        // To be overridden in system specific implementation.
        return true;
    },
    isPopupAreaFree: async (EAO) => {
        // To be overridden in system specific implementation.
        return true;
    },
    config: {
        apiUrl: '',
        remoteApiUrl: '',
        apiKey: '',
        lang: ( function() {
            if (document.querySelector('html').lang) {
                // TODO: check if the language is in the list of possible languages and return "de" if not.
                return document.documentElement.lang.slice(0,2);
            } else {
                return 'de';
            }
        })(),
        showDebugInfo: false,
        splitStreet: true,
        useAutocomplete: true,
        ux: {
            smartFill: true,
            smartFillBlockTime: 600,
            resumeSubmit: true,
            disableBrowserAutocomplete: true,
            maxAutocompletePredictionItems: 100,
            maxAddressPredictionItems: 3,
            useStandardCss: true,
            cssFilePath: '',
            confirmWithCheckbox: false,
            correctTranspositionedNames: false,
            delay: {
                inputAssistant: 100,
                streetCopy: 600
            },
            requestTimeout: 8000
        },
        trigger: {
            onblur: true,
            onsubmit: true
        },
        texts: {
            popUpHeadline: 'Adresse pr&uuml;fen',
            popUpSubline: 'Die eingegebene Adresse scheint nicht korrekt oder unvollständig zu sein. Bitte eine korrekte Adresse wählen.',
            yourInput: 'Ihre Eingabe:',
            editYourInput: '(bearbeiten)',
            ourSuggestions: 'Unsere Vorschläge:',
            useSelected: 'Auswahl übernehmen',
            popupHeadlines: {
                general_address: 'Adresse pr&uuml;fen',
                billing_address: 'Rechnungsadresse pr&uuml;fen',
                shipping_address: 'Lieferadresse pr&uuml;fen'
            }
        },
        templates: {

        }
    },
    postfix: {
        ams: {
            countryCode: '',
            postalCode: '',
            locality: '',
            streetFull: '',
            streetName: '',
            buildingNumber: '',
            addressStatus: '',
            addressTimestamp: '',
            addressPredictions: '',
            additionalInfo: '',
        },
        emailServices: {
            email: ''
        },
        personServices: {
            salutation: '',
            firstName: '',
            lastName: '',
            nameScore: ''
        }
    },
    activeServices: {
        ams: true,
        emailService: true,
        personService: true
    },
    checkAllCallback: function() {
        return;
    },
    hasActiveSubscriber: (fieldName, domElement, dataObject) => {
        if (fieldName === 'subdivisionCode' && domElement && domElement.tagName === 'SELECT') {
            // window.EnderecoIntegrator.subdivisionMappingReverse keys contain local ID's
            const selectState = checkSelectValuesAgainstMapping(
                domElement,
                window.EnderecoIntegrator.subdivisionMappingReverse
            );
            return selectState.hasValidOptions && selectState.allValuesInMapping;
        }

        return true;
    },
    mappings: {
        gender: {
            'M': 'mr',
            'F': 'ms',
            getByCode: function(code) {
                if (this[code]) {
                    return this[code]
                } else {
                    return '';
                }
            },
            getBySalutation: function(salutation) {
                var $return = '';
                for (var prop in this) {
                    if (Object.prototype.hasOwnProperty.call(this, prop)) {
                        if (this[prop] === salutation) {
                            return prop;
                        }
                    }
                }
                return $return;
            }
        }
    },
    resolvers: {},
    initPhoneServices: function(
      prefix,
      options= {
          postfixCollection: {},
          name: 'default'
      }
    ) {
        $self = this;
        if (!this.activeServices.phs) {
            return;
        }

        var $self = this;
        var config = JSON.parse(JSON.stringify(this.config));

        if (!!options.config) {
            config = merge(config, options.config);
        }

        var originalPostfix = merge({}, $self.postfix.phs);
        var postfix;

        if ('object' === typeof prefix) {
            postfix = merge(originalPostfix, prefix);
            prefix = '';
        } else {
            var newObject = {};
            Object.keys(originalPostfix).forEach(function(key) {
                newObject[key] = prefix + originalPostfix[key];

            });
            postfix = merge(newObject, options.postfixCollection);
        }

        var EPHSO = new EnderecoPhoneObject(config);
        EPHSO.fullName = options.name + '_' + EPHSO.name;

        // Start setting default values.
        if (!!options.numberType) {
            EPHSO.numberType = options.numberType
        }

        EPHSO.waitForAllExtension().then( function() {
            // Add subscribers.
            if (
              $self.dispatchEvent('endereco.ams.before-adding-subscribers')
            ) {

                // In general with every subscriber we first check, if the html element exists
                // Then we trigger an event.
                if (
                  document.querySelector($self.getSelector(postfix.phone)) &&
                  $self.dispatchEvent('endereco.ams.before-adding-phone-subscriber')
                ) {
                    var phoneSubscriberOptions = {};
                    if (!!$self.resolvers.phoneWrite) {
                        phoneSubscriberOptions['writeFilterCb'] = function(value, subscriber) {
                            return $self.resolvers.phoneWrite(value, subscriber);
                        }
                    }
                    if (!!$self.resolvers.phoneRead) {
                        phoneSubscriberOptions['readFilterCb'] = function(value) {
                            return $self.resolvers.phoneRead(value, subscriber);
                        }
                    }
                    if (!!$self.resolvers.phoneSetValue) {
                        phoneSubscriberOptions['customSetValue'] = function(subscriber, value) {
                            return $self.resolvers.phoneSetValue(subscriber, value);
                        }
                    }

                    var phoneSubscriber = new EnderecoSubscriber(
                      'phone',
                      document.querySelector($self.getSelector(postfix.phone)),
                      phoneSubscriberOptions
                    )
                    EPHSO.addSubscriber(phoneSubscriber);

                    $self.dispatchEvent('endereco.ams.after-adding-phone-subscriber'); // Add after hook.
                }

                // In general with every subscriber we first check, if the html element exists
                // Then we trigger an event.
                if (
                    !! postfix.countryCode &&
                    document.querySelector($self.getSelector(postfix.countryCode)) &&
                    $self.dispatchEvent('endereco.ams.before-adding-country-code-subscriber')
                ) {
                    var countryCodeSubscriberOptions = {};
                    if (!!$self.resolvers.countryCodeWrite) {
                        countryCodeSubscriberOptions['writeFilterCb'] = function(value, subscriber) {
                            return $self.resolvers.countryCodeWrite(value, subscriber);
                        }
                    }
                    if (!!$self.resolvers.countryCodeRead) {
                        countryCodeSubscriberOptions['readFilterCb'] = function(value, subscriber) {
                            return $self.resolvers.countryCodeRead(value, subscriber);
                        }
                    }
                    if (!!$self.resolvers.countryCodeSetValue) {
                        countryCodeSubscriberOptions['customSetValue'] = function(subscriber, value) {
                            return $self.resolvers.countryCodeSetValue(subscriber, value);
                        }
                    }
                    var countryCodeSubscriber = new EnderecoSubscriber(
                        'countryCode',
                        document.querySelector($self.getSelector(postfix.countryCode)),
                        countryCodeSubscriberOptions
                    )
                    EPHSO.addSubscriber(countryCodeSubscriber);

                    $self.dispatchEvent('endereco.ams.after-adding-country-code-subscriber'); // Add after hook.
                }

                $self.dispatchEvent('endereco.ams.after-adding-subscribers')

                EPHSO.waitUntilReady().then(function() {
                    EPHSO.syncValues().then(function() {
                        EPHSO.waitUntilReady().then(function() {
                            // Start setting default values.
                            if (!!options.numberType) {
                                EPHSO.numberType = options.numberType
                            } else if (!!window.EnderecoIntegrator.config.defaultPhoneType) {
                                EPHSO.numberType = window.EnderecoIntegrator.config.defaultPhoneType;
                            }

                            EPHSO.renderFlags();

                            EPHSO._changed = false;
                            EPHSO.activate();

                            if (!!$self.afterPHSActivation) {
                                $self.afterPHSActivation.forEach( function(callback) {
                                    callback(EPHSO);
                                })
                            }
                        }).catch();
                    }).catch()
                }).catch();
            }
        }).catch();

        this.integratedObjects[EPHSO.fullName] = EPHSO;
        return EPHSO;
    },
    test: {},
    initAMS: async(
        fieldSelectors,
        options= {
            addressType: 'general_address',
            name: 'default',
            beforeActivation: undefined,
            intent: 'edit',
            targetSelector: 'body',
            insertPosition: 'beforeend'
        }
    ) => {
        if (!window.EnderecoIntegrator.activeServices.ams) {
            return;
        }
        
        const integrator = window.EnderecoIntegrator;
        // Create the object
        const addressObject = await new EnderecoAddressObject(integrator.config);
        await addressObject.waitForAllExtension();
        addressObject.fullName = options.name;

        // Initiate change field order logic
        if (integrator.config.ux.changeFieldsOrder &&
            integrator.config.useAutocomplete
        ) {
            EnderecoIntegrator.changeFieldsOrder(fieldSelectors)
        }

        // Bind all address-related fields to the address object
        await bindFieldsToAddressObject(addressObject, fieldSelectors, integrator);

        await addressObject.waitUntilReady();
        await addressObject.syncValues()

        addressObject.setIntent(options.intent);

        addressObject.setTargetSelector(options.targetSelector);
        addressObject.setInsertPosition(options.insertPosition);

        // Preselect a value.
        if (!addressObject.getCountryCode() && integrator.defaultCountrySelect) {
            await addressObject.setCountryCode(integrator.defaultCountry);
        }

        if (!!options.addressType) {
            await addressObject.setAddressType(options.addressType)
        }

        if (!!options.beforeActivation) {
            await options.beforeActivation(addressObject);
        }

        await addressObject.waitUntilReady();

        addressObject.activate();

        // Preselect a value.
        if (!addressObject.getCountryCode() && integrator.defaultCountrySelect) {
            await addressObject.setCountryCode(integrator.defaultCountry);
        }

        integrator.afterAMSActivation.forEach( (callback) => {
            callback(addressObject);
        })

        await addressObject.waitUntilReady();
        
        if (!addressObject.util.isAddressCheckFinished()) {
            addressObject.util.markAddressDirty();
        }

        addressObject.util.preheatCache();
        if (addressObject.util.isReviewIntent() && addressObject.util.shouldBeChecked()) {
            addressObject.util.checkAddress()
        } else {
            addressObject.util.indicateStatuscodes(
                addressObject.addressStatus
            );
        }

        integrator.integratedObjects[addressObject.fullName] = addressObject;

        // Connect to form
        integrator.subscribeToSubmit(addressObject)

        return addressObject;
    },
    unblockSubmitButton: (form) => {
        if (!form || !(form instanceof HTMLElement)) {
            console.warn('Invalid form element provided to unblockSubmitButton');
            return;
        }

        const submitButtons = form.querySelectorAll('button[type="submit"], input[type="submit"]');

        submitButtons.forEach(button => {
            if (button.hasAttribute('disabled')) {
                button.removeAttribute('disabled');
            }

            const disabledClasses = ['disabled', 'btn-disabled', 'is-disabled', 'form-disabled'];
            disabledClasses.forEach(className => {
                if (button.classList.contains(className)) {
                    button.classList.remove(className);
                }
            });

            button.disabled = false;
        });
    },
    subscribeToSubmit: (dataObject) => {
        const integrator = window.EnderecoIntegrator;

        // Check if submit listener is present
        const forms = integrator.findForms(dataObject._subscribers);
        forms.forEach( (form) => {
            integrator.addSubmitListener(form, dataObject, integrator)
        })
    },
    addSubmitListener: (form, dataObject, integrator) => {
        if (!integrator.formSubmitListeners.has(form)) {
            integrator.formSubmitListeners.set(form, []);
            attachSubmitListenersToForm(form);
        }
        integrator.formSubmitListeners.get(form).push(dataObject);
    },
    findForms: (subscriberCollection) => {
        const forms = [];
        for (const [fieldName, subscribers] of Object.entries(subscriberCollection)) {
            if (subscribers.length === 0) {
                continue;
            }

            if (!subscribers[0].object) {
                continue;
            }

            const closestForm = subscribers[0].object.closest('form');
            if (closestForm && !forms.includes(closestForm)) {
                forms.push(closestForm);
            }
        }
        return forms;
    },
    formSubmitListeners: new Map(),
    afterAMSActivation: [],
    customSubmitButtonHandlers: [],
    customFormReferenceResolvers: [],
    onAjaxFormHandler: [],
    initEmailServices: function(
        prefix,
        options = {
            postfixCollection: {},
            name: 'default'
        }
    ) {
        if (!this.activeServices.emailService) {
            return;
        }

        var $self = this;
        var config = JSON.parse(JSON.stringify(this.config));

        var originalPostfix = merge({}, $self.postfix.emailServices);
        var postfix;

        if ('object' === typeof prefix) {
            postfix = merge(originalPostfix, prefix);
            prefix = '';
        } else {
            var newObject = {};
            Object.keys(originalPostfix).forEach(function(key) {
                newObject[key] = prefix + originalPostfix[key];

            });
            postfix = merge(newObject, options.postfixCollection);
        }

        if (!!options.errorContainer) {
            config.ux.errorContainer = options.errorContainer
        }

        if (!!options.errorInsertMode) {
            config.ux.errorInsertMode = options.errorInsertMode
        }

        var EEO = new EnderecoEmailObject(config);
        EEO.fullName = options.name + '_' + EEO.name;

        EEO._awaits++;
        EEO.waitForAllExtension().then( function() {
            if (
                $self.dispatchEvent('endereco.es.before-adding-subscribers')
            ) {
                if (
                    document.querySelector($self.getSelector(prefix + postfix.email)) &&
                    $self.dispatchEvent('endereco.es.before-adding-email-subscriber')
                ) {
                    var emailSubscriber = new EnderecoSubscriber(
                        'email',
                        document.querySelector($self.getSelector(prefix + postfix.email)),
                        {
                            writeFilterCb: function(value, subscriber) {
                                if (!!$self.resolvers.emailWrite) {
                                    return $self.resolvers.emailWrite(value, subscriber);
                                } else {
                                    return new EEO.util.Promise(function(resolve, reject) {
                                        resolve(value);
                                    });
                                }
                            },
                            readFilterCb: function(value, subscriber) {
                                if (!!$self.resolvers.emailRead) {
                                    return $self.resolvers.emailRead(value, subscriber);
                                } else {
                                    return new EEO.util.Promise(function(resolve, reject) {
                                        resolve(value);
                                    });
                                }
                            }
                        }
                    )
                    EEO.addSubscriber(emailSubscriber);
                    $self.dispatchEvent('endereco.es.after-adding-email-subscriber'); // Add after hook.
                }

                if (
                    document.querySelector($self.getSelector(prefix + postfix.email)) &&
                    $self.dispatchEvent('endereco.es.before-adding-email-status-subscriber')
                ) {
                    var emailStatusSubscriber = new EnderecoSubscriber(
                        'emailStatus',
                        document.querySelector($self.getSelector(prefix + postfix.email)),
                        {
                            writeFilterCb: function(value, subscriber) {
                                if (!!$self.resolvers.emailStatusWrite) {
                                    return $self.resolvers.emailStatusWrite(value, subscriber);
                                } else {
                                    return new EEO.util.Promise(function(resolve, reject) {
                                        resolve(value);
                                    });
                                }
                            },
                            readFilterCb: function(value, subscriber) {
                                if (!!$self.resolvers.emailStatusRead) {
                                    return $self.resolvers.emailStatusRead(value, subscriber);
                                } else {
                                    return new EEO.util.Promise(function(resolve, reject) {
                                        resolve(value);
                                    });
                                }
                            },
                            valueContainer: 'classList'
                        }
                    )
                    EEO.addSubscriber(emailStatusSubscriber);
                    $self.dispatchEvent('endereco.es.after-adding-email-status-subscriber'); // Add after hook.
                }

                $self.dispatchEvent('endereco.es.after-adding-subscribers')
            }

            EEO._awaits--;
        }).catch();

        EEO.waitUntilReady().then(function() {
            EEO.syncValues().then(function() {
                EEO.waitUntilReady().then(function() {
                    EEO._changed = false;
                    EEO.activate();
                }).catch();
            }).catch()
        }).catch();

        this.integratedObjects[EEO.fullName] = EEO;
        return EEO;
    },
    initPersonServices: function(
        prefix = '',
        options= {
            postfixCollection: {},
            name: 'default'
        }
    ) {
        $self = this;
        if (!this.activeServices.personService) {
            return;
        }

        var $self = this;
        var config = JSON.parse(JSON.stringify(this.config));

        if (!!options.config) {
            config = merge(config, options.config);
        }

        var originalPostfix = merge({}, $self.postfix.personServices);
        var postfix;

        if ('object' === typeof prefix) {
            postfix = merge(originalPostfix, prefix);
            prefix = '';
        } else {
            postfix = merge(originalPostfix, options.postfixCollection);
        }

        var EPO = new EnderecoPersonObject(config);
        EPO.fullName = options.name + '_' + EPO.name;
        EPO._awaits++;
        EPO.waitForAllExtension().then( function() {
            // Add subscribers.
            if (
                $self.dispatchEvent('endereco.ps.before-adding-subscribers')
            ) {
                // In general with every subscriber we first check, if the html element exists
                if (
                    document.querySelector($self.getSelector(prefix + postfix.salutation)) &&
                    $self.dispatchEvent('endereco.ps.before-adding-salutation-subscriber')
                ) {
                    var salutationSubscriberOptions = {};
                    if (!!$self.resolvers.salutationWrite) {
                        salutationSubscriberOptions['writeFilterCb'] = function(value, subscriber) {
                            return $self.resolvers.salutationWrite(value, subscriber);
                        }
                    }
                    if (!!$self.resolvers.salutationRead) {
                        salutationSubscriberOptions['readFilterCb'] = function(value, subscriber) {
                            return $self.resolvers.salutationRead(value, subscriber);
                        }
                    }
                    if (!!$self.resolvers.salutationSetValue) {
                        salutationSubscriberOptions['customSetValue'] = function(subscriber, value) {
                            return $self.resolvers.salutationSetValue(subscriber, value);
                        }
                    }
                    var salutationSubscriber = new EnderecoSubscriber(
                        'salutation',
                        document.querySelector($self.getSelector(prefix + postfix.salutation)),
                        salutationSubscriberOptions
                    )
                    EPO.addSubscriber(salutationSubscriber);

                    $self.dispatchEvent('endereco.ps.after-adding-salutation-subscriber'); // Add after hook.
                }
                // In general with every subscriber we first check, if the html element exists
                if (
                    document.querySelector($self.getSelector(prefix + postfix.firstName)) &&
                    $self.dispatchEvent('endereco.ps.before-adding-first-name-subscriber')
                ) {
                    var firstNameSubscriber = new EnderecoSubscriber(
                        'firstName',
                        document.querySelector($self.getSelector(prefix + postfix.firstName)),
                        {
                            writeFilterCb: function(value, subscriber) {
                                if (!!$self.resolvers.firstNameWrite) {
                                    return $self.resolvers.firstNameWrite(value, subscriber);
                                } else {
                                    return new EPO.util.Promise(function(resolve, reject) {
                                        resolve(value);
                                    });
                                }
                            },
                            readFilterCb: function(value, subscriber) {
                                if (!!$self.resolvers.firstNameRead) {
                                    return $self.resolvers.firstNameRead(value, subscriber);
                                } else {
                                    return new EPO.util.Promise(function(resolve, reject) {
                                        resolve(value);
                                    });
                                }
                            }
                        }
                    )
                    EPO.addSubscriber(firstNameSubscriber);

                    $self.dispatchEvent('endereco.ps.after-adding-first-name-subscriber'); // Add after hook.
                }
                if (
                  document.querySelector($self.getSelector(prefix + postfix.lastName)) &&
                  $self.dispatchEvent('endereco.ps.before-adding-last-name-subscriber')
                ) {
                    var lastNameSubscriberOptions = {};
                    if (!!$self.resolvers.lastNameWrite) {
                        lastNameSubscriberOptions['writeFilterCb'] = function(value, subscriber) {
                            return $self.resolvers.lastNameWrite(value, subscriber);
                        }
                    }
                    if (!!$self.resolvers.lastNameRead) {
                        lastNameSubscriberOptions['readFilterCb'] = function(value, subscriber) {
                            return $self.resolvers.lastNameRead(value, subscriber);
                        }
                    }
                    if (!!$self.resolvers.lastNameSetValue) {
                        lastNameSubscriberOptions['customSetValue'] = function(subscriber, value) {
                            return $self.resolvers.lastNameSetValue(subscriber, value);
                        }
                    }
                    var lastNameSubscriber = new EnderecoSubscriber(
                      'lastName',
                      document.querySelector($self.getSelector(prefix + postfix.lastName)),
                      lastNameSubscriberOptions
                    )
                    EPO.addSubscriber(lastNameSubscriber);

                    $self.dispatchEvent('endereco.ps.after-adding-last-name-subscriber'); // Add after hook.
                }
                if (
                  document.querySelector($self.getSelector(prefix + postfix.title)) &&
                  $self.dispatchEvent('endereco.ps.before-adding-title-subscriber')
                ) {
                    var titleSubscriberOptions = {};
                    if (!!$self.resolvers.titleWrite) {
                        titleSubscriberOptions['writeFilterCb'] = function(value, subscriber) {
                            return $self.resolvers.titleWrite(value, subscriber);
                        }
                    }
                    if (!!$self.resolvers.titleRead) {
                        titleSubscriberOptions['readFilterCb'] = function(value, subscriber) {
                            return $self.resolvers.titleRead(value, subscriber);
                        }
                    }
                    if (!!$self.resolvers.titleSetValue) {
                        titleSubscriberOptions['customSetValue'] = function(subscriber, value) {
                            return $self.resolvers.titleSetValue(subscriber, value);
                        }
                    }
                    var titleSubscriber = new EnderecoSubscriber(
                      'title',
                      document.querySelector($self.getSelector(prefix + postfix.title)),
                      titleSubscriberOptions
                    )
                    EPO.addSubscriber(titleSubscriber);

                    $self.dispatchEvent('endereco.ps.after-adding-title-subscriber'); // Add after hook.
                }
                if (
                  document.querySelector($self.getSelector(prefix + postfix.nameScore)) &&
                  $self.dispatchEvent('endereco.ps.before-adding-name-score-subscriber')
                ) {
                    var nameScoreSubscriberOptions = {};
                    if (!!$self.resolvers.nameScoreWrite) {
                        nameScoreSubscriberOptions['writeFilterCb'] = function(value, subscriber) {
                            return $self.resolvers.nameScoreWrite(value, subscriber);
                        }
                    }
                    if (!!$self.resolvers.nameScoreRead) {
                        nameScoreSubscriberOptions['readFilterCb'] = function(value, subscriber) {
                            return $self.resolvers.nameScoreRead(value, subscriber);
                        }
                    }
                    if (!!$self.resolvers.nameScoreSetValue) {
                        nameScoreSubscriberOptions['customSetValue'] = function(subscriber, value) {
                            return $self.resolvers.nameScoreSetValue(subscriber, value);
                        }
                    }
                    var nameScoreSubscriber = new EnderecoSubscriber(
                      'nameScore',
                      document.querySelector($self.getSelector(prefix + postfix.nameScore)),
                      nameScoreSubscriberOptions
                    )
                    EPO.addSubscriber(nameScoreSubscriber);

                    $self.dispatchEvent('endereco.ps.after-adding-name-score-subscriber'); // Add after hook.
                }
            }

            EPO._awaits--;
        });

        EPO.waitUntilReady().then(function() {
            EPO.syncValues().then(function() {
                EPO.waitUntilReady().then(function() {
                    // Start setting default values.
                    EPO._changed = false;
                    EPO.activate();
                }).catch();
            }).catch()
        }).catch();

        this.integratedObjects[EPO.fullName] = EPO;
        return EPO;
    },
    waitUntilReady: function() {
        var $self = this;
        return new Promise(function(resolve, reject) {
            var interval = setInterval(function() {
                if (window.EnderecoIntegrator.ready) {
                    clearInterval(interval);
                    resolve();
                }
            }, 100);
        })
    },
    getSelector: function(possibleSelector) {
        var selector = '';
        if  (!possibleSelector) {
            selector = null;
        } else if (
            (possibleSelector.indexOf('#') === -1) &&
            (possibleSelector.indexOf('.') === -1) &&
            (possibleSelector.indexOf('=') === -1)
        ) {
            selector = '[name="'+possibleSelector+'"]';
        } else {
            selector = possibleSelector;
        }
        return selector;
    },
    integratedObjects: {},
    asyncCallbacks: [],
    addCss: function () {

        // Clean up beforehand (just in case)
        var stylesDOM = document.getElementById('#endereco-styles-include');
        if (stylesDOM) {
            stylesDOM.remove();
        }

        if (this.config.ux.useStandardCss) {
            if(!this.css && !this.config.ux.cssFilePath){
                return;
            }

            const cssLink = this.config.ux.cssFilePath || 'data:text/css;charset=UTF-8,' + encodeURIComponent(this.css);
            var head = document.querySelector('head');
            var linkElement = document.createElement('link');
            linkElement.setAttribute('id', 'endereco-styles-include');
            linkElement.setAttribute('rel', 'stylesheet');
            linkElement.setAttribute('type', 'text/css');
            linkElement.setAttribute('href', cssLink);
            head.appendChild(linkElement);
        }
    },
    addBodyClass: function() {
        if (!!this.themeName) {
            document.querySelector('body').classList.add('endereco-theme--'+this.themeName);
        } else {
            document.querySelector('body').classList.add('endereco-theme--current-theme');
        }
    },
    dispatchEvent: function(event) {
        return true;
    },
    _createParentLine: function(fieldName, collector, collection) {
        if (document.querySelector((this.getSelector(collection[fieldName])))) {
            collector[fieldName] = {
                commonElementIndex: 0,
                rowElementIndex: 0,
                columnElementIndex: 0,
                parentLine: [document.querySelector((this.getSelector(collection[fieldName])))]
            }
            while (1) {
                if (collector[fieldName].parentLine[collector[fieldName].parentLine.length-1].parentNode) {
                    var temp = collector[fieldName].parentLine[collector[fieldName].parentLine.length-1].parentNode;
                    collector[fieldName].parentLine.push(temp);
                } else {
                    break;
                }
            }
        }
    },
    _firstBeforeSecond: function(firstFieldName, secondFieldName, collector) {
        if (
            !collector[firstFieldName] ||
            !collector[secondFieldName]
        ) {
            return;
        }

        // Find commen parent.
        var firstFieldData = collector[firstFieldName];
        var firstFieldIndex = 0;
        var secondFieldData = collector[secondFieldName];
        var secondFieldIndex = 0;
        var commonParentDOM = undefined;
        if (firstFieldData.parentLine && secondFieldData.parentLine) {
            firstFieldData.parentLine.forEach( function(firstFieldParentDOM) {
                if (commonParentDOM) {
                    return;
                }
                secondFieldIndex = 0;
                secondFieldData.parentLine.forEach( function(secondFieldParentDOM) {
                    if (commonParentDOM) {
                        return;
                    }
                    if (firstFieldParentDOM === secondFieldParentDOM) {
                        commonParentDOM = firstFieldParentDOM;
                        firstFieldData.commonElementIndex = firstFieldIndex;
                        firstFieldData.rowElementIndex = Math.max(firstFieldIndex-1, 0);
                        firstFieldData.columnElementIndex =  Math.max(firstFieldIndex-2, 0);
                        secondFieldData.commonElementIndex = secondFieldIndex;
                        secondFieldData.rowElementIndex =  Math.max(secondFieldIndex-1, 0);
                        secondFieldData.columnElementIndex =  Math.max(secondFieldIndex-2, 0);
                    }
                    secondFieldIndex++;
                })

                firstFieldIndex++;
            })

            if (commonParentDOM) {
                commonParentDOM.insertBefore(
                    firstFieldData.parentLine[firstFieldData.rowElementIndex],
                    secondFieldData.parentLine[secondFieldData.rowElementIndex]
                )
            }
        }
    },
    _test: {},
    changeFieldsOrder: function(collection, fieldNamesOrder = ['countryCode', 'subdivisionCode', 'postalCode', 'locality', 'streetFull', 'streetName','buildingNumber', 'additionalInfo']) {
        var myStructure = {};
        // Create parent line for additional info if it exists.
        this._createParentLine('additionalInfo', this._test, collection);
        this._createParentLine('buildingNumber', this._test, collection);
        this._createParentLine('streetName', this._test, collection);
        this._createParentLine('streetFull', this._test, collection);
        this._createParentLine('locality', this._test, collection);
        this._createParentLine('postalCode', this._test, collection);
        this._createParentLine('countryCode', this._test, collection);
        this._createParentLine('subdivisionCode', this._test, collection);

        // Ensure position.
        var reversedArray = new Array;
        for(var i = fieldNamesOrder.length-1; i >= 0; i--) {
            // Filterout if not existing.
            if (
                document.querySelector(
                    this.getSelector(collection[fieldNamesOrder[i]])
                )
            ) {
                reversedArray.push(fieldNamesOrder[i]);
            }
        }

        // Change positions in the DOM.
        for (var j=0; j<(reversedArray.length-1); j++) {
            this._firstBeforeSecond(reversedArray[j+1], reversedArray[j], this._test);
        }
    }
}

EnderecoIntegrator.waitUntilReady().then( function() {
    if (window.EnderecoIntegrator.config) {
        EnderecoIntegrator.config = merge(EnderecoIntegrator.config, window.EnderecoIntegrator.config);
    }
    EnderecoIntegrator.addCss();
    EnderecoIntegrator.addBodyClass();
}).catch();

export default EnderecoIntegrator;
