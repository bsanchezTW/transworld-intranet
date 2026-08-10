(function (global) {
  const FULL_PATTERN = /^\+56 9 \d{4} \d{4}$/;
  const LOCAL_PATTERN = /^9 \d{4} \d{4}$/;
  const PREFIX = "+56 ";
  const ERROR_MSG = "Ingresa un celular válido con formato 9 1234 5678.";

  function isValidChileMobilePhone(phone) {
    return FULL_PATTERN.test(String(phone || "").trim());
  }

  function isValidLocalPhone(local) {
    return LOCAL_PATTERN.test(String(local || "").trim());
  }

  function toLocalPart(fullPhone) {
    const val = String(fullPhone || "").trim();
    if (!val) return "";
    if (val.startsWith("+56")) return val.slice(3).trim();
    if (val.startsWith("56") && /\s/.test(val)) return val.slice(2).trim();

    const digits = val.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("569")) {
      return formatLocalInput(digits.slice(2));
    }
    if (digits.length === 9 && digits.startsWith("9")) {
      return formatLocalInput(digits);
    }

    return val;
  }

  function toFullPhone(localPart) {
    const local = String(localPart || "").trim();
    if (!isValidLocalPhone(local)) return "";
    return PREFIX + local;
  }

  function formatLocalInput(raw) {
    let digits = String(raw || "").replace(/\D/g, "");

    if (digits.startsWith("56")) digits = digits.slice(2);
    if (digits.startsWith("0")) digits = digits.slice(1);

    digits = digits.slice(0, 9);

    if (!digits.length) return "";
    if (digits.length === 1) return digits;
    if (digits.length <= 5) {
      return digits.charAt(0) + " " + digits.slice(1);
    }
    return (
      digits.charAt(0) + " " + digits.slice(1, 5) + " " + digits.slice(5)
    );
  }

  function initField(root, options) {
    if (!root) return null;

    const localInput = root.querySelector(".phone-field__local");
    const hiddenInput =
      root.querySelector('input[type="hidden"][name="phone"]') ||
      root.querySelector('input[type="hidden"][name="telefono"]') ||
      root.querySelector(".phone-field__full");

    if (!localInput || !hiddenInput) return null;

    const onChange =
      options && typeof options.onChange === "function" ? options.onChange : null;

    function sync() {
      const formatted = formatLocalInput(localInput.value);
      if (localInput.value !== formatted) {
        localInput.value = formatted;
      }

      const full = toFullPhone(formatted);
      hiddenInput.value = full;

      const hasPartial = formatted.length > 0;
      localInput.setCustomValidity(
        hasPartial && !isValidLocalPhone(formatted) ? ERROR_MSG : "",
      );

      if (onChange) onChange(full, formatted);
    }

    localInput.addEventListener("input", sync);
    localInput.addEventListener("blur", sync);

    if (!localInput.value.trim() && hiddenInput.value) {
      localInput.value = toLocalPart(hiddenInput.value);
    }

    sync();

    return {
      root,
      localInput,
      hiddenInput,
      sync,
      getValue: () => hiddenInput.value,
    };
  }

  function isFieldValid(root) {
    if (!root) return false;
    const hiddenInput =
      root.querySelector('input[type="hidden"][name="phone"]') ||
      root.querySelector('input[type="hidden"][name="telefono"]');
    return hiddenInput
      ? isValidChileMobilePhone(hiddenInput.value)
      : false;
  }

  function isFieldEmpty(root) {
    if (!root) return true;
    const localInput = root.querySelector(".phone-field__local");
    return !localInput || !localInput.value.trim();
  }

  function bindTelefonoInput(input, options) {
    const root = input && input.closest("[data-phone-chile]");
    if (root) return initField(root, options);
    return null;
  }

  global.PhoneChile = {
    FULL_PATTERN,
    LOCAL_PATTERN,
    ERROR_MSG,
    isValidChileMobilePhone,
    isValidLocalPhone,
    toLocalPart,
    toFullPhone,
    formatLocalInput,
    initField,
    isFieldValid,
    isFieldEmpty,
    bindTelefonoInput,
  };
})(typeof window !== "undefined" ? window : globalThis);
