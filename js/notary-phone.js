'use strict';

window.DocuSealPhone = {
    formatDisplay(value) {
        const digits = String(value || '').replace(/\D/g, '').slice(0, 10);
        if (digits.length < 4) return digits;
        if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    },

    isValidDisplay(value) {
        return /^\(\d{3}\) \d{3}-\d{4}$/.test(String(value || '').trim());
    },

    bind(input) {
        if (!input) return;
        input.addEventListener('input', () => {
            input.value = this.formatDisplay(input.value);
        });
    },

    init(root = document) {
        root.querySelectorAll('input[type="tel"], input[data-phone-us]').forEach((el) => this.bind(el));
    },
};
