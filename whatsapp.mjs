export function createRecipientResolver(raw = '') {
  let overrides = {};
  if (raw) {
    try { overrides = JSON.parse(raw); }
    catch { throw new Error('WHATSAPP_RECIPIENT_OVERRIDES debe ser un objeto JSON.'); }
    if (!overrides || Array.isArray(overrides) || typeof overrides !== 'object' ||
        Object.entries(overrides).some(([from,to]) => !/^\d{10,15}$/.test(from) || typeof to !== 'string' || !/^\d{10,15}$/.test(to))) {
      throw new Error('Los alias de destinatarios deben contener solo números internacionales verificados.');
    }
  }
  // Los alias afectan solo al envío. La identidad y los turnos conservan el remitente validado.
  return sender => {
    if (!/^\d{10,15}$/.test(sender)) throw new Error('Destinatario inválido.');
    return Object.hasOwn(overrides,sender) ? overrides[sender] : sender;
  };
}
