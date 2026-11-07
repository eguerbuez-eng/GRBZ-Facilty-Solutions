// Entitätsdefinitionen: Grundlage für generische Formulare/Listen (Client)
// und für die Feldvalidierung (Server). Spezielle Geschäftslogik
// (Aufträge, Zeiterfassung, Bestand, Mängel …) liegt in eigenen Befehlen.

import { DEFECT_KINDS, DEFECT_STATUS, WINTER_WEATHER, WINTER_ACTIVITIES } from './constants.js';

const opt = (o) => Object.entries(o).map(([value, label]) => ({ value, label }));

export const ENTITIES = {
  customers: {
    label: 'Kunde', plural: 'Kunden', table: 'customers', numberField: 'customer_no',
    read: 'customers.read', write: 'customers.write', archivable: true,
    title: (r) => r.company_name, subtitle: (r) => [r.customer_no, r.contact_person, r.billing_city].filter(Boolean).join(' · '),
    search: ['customer_no', 'company_name', 'contact_person', 'email', 'phone', 'billing_city'],
    fields: [
      { name: 'customer_type', label: 'Kundenart', type: 'select', options: opt({ firma: 'Firma', privat: 'Privatkunde', verwaltung: 'Hausverwaltung', oeffentlich: 'Öffentliche Einrichtung' }), required: true, default: 'firma' },
      { name: 'company_name', label: 'Firmenname / Name', type: 'text', required: true, list: true },
      { name: 'contact_person', label: 'Ansprechpartner', type: 'text', list: true },
      { name: 'phone', label: 'Telefon', type: 'tel' },
      { name: 'email', label: 'E-Mail', type: 'email' },
      { name: 'billing_street', label: 'Rechnungsadresse – Straße', type: 'text' },
      { name: 'billing_zip', label: 'PLZ', type: 'text', half: true },
      { name: 'billing_city', label: 'Ort', type: 'text', half: true, list: true },
      { name: 'contract_status', label: 'Vertragsstatus', type: 'select', options: opt({ interessent: 'Interessent', angebot: 'Angebot', aktiv: 'Aktiv', pausiert: 'Pausiert', gekuendigt: 'Gekündigt', beendet: 'Beendet' }), default: 'aktiv', list: true },
      { name: 'notes', label: 'Notizen', type: 'textarea' },
    ],
  },
  contact_history: {
    label: 'Kontakt', plural: 'Kontakthistorie', table: 'contact_history',
    read: 'customers.read', write: 'customers.write', deletable: true,
    title: (r) => r.subject,
    fields: [
      { name: 'customer_id', label: 'Kunde', type: 'ref', ref: 'customers', required: true },
      { name: 'contact_date', label: 'Datum', type: 'date', required: true, default: 'today' },
      { name: 'channel', label: 'Kanal', type: 'select', options: opt({ telefon: 'Telefon', email: 'E-Mail', vor_ort: 'Vor Ort', brief: 'Brief', sonstiges: 'Sonstiges' }), default: 'telefon' },
      { name: 'subject', label: 'Betreff', type: 'text', required: true },
      { name: 'notes', label: 'Notizen', type: 'textarea' },
    ],
  },
  services: {
    label: 'Dienstleistung', plural: 'Dienstleistungen', table: 'services',
    read: 'dashboard.view', write: 'checklists.manage',
    title: (r) => r.name,
    fields: [
      { name: 'name', label: 'Bezeichnung', type: 'text', required: true, list: true },
      { name: 'description', label: 'Beschreibung', type: 'textarea' },
      { name: 'active', label: 'Aktiv', type: 'bool', default: 1 },
    ],
  },
  objects: {
    label: 'Objekt', plural: 'Objekte', table: 'objects', numberField: 'object_no',
    read: 'objects.read', write: 'objects.write', archivable: true,
    title: (r) => r.name, subtitle: (r) => [r.object_no, [r.street, r.city].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
    search: ['object_no', 'name', 'street', 'city', 'contact_person'],
    fields: [
      { name: 'customer_id', label: 'Kunde', type: 'ref', ref: 'customers', required: true, list: true },
      { name: 'name', label: 'Objektname', type: 'text', required: true, list: true },
      { name: 'object_type', label: 'Objektart', type: 'select', options: opt({ buero: 'Büro', praxis: 'Praxis', kita: 'Kita', wohnhaus: 'Wohnhaus / Treppenhaus', gewerbe: 'Gewerbe / Halle', schule: 'Schule', handel: 'Einzelhandel', privat: 'Privathaushalt', aussenanlage: 'Außenanlage', sonstiges: 'Sonstiges' }), list: true },
      { name: 'street', label: 'Straße und Hausnummer', type: 'text' },
      { name: 'zip', label: 'PLZ', type: 'text', half: true },
      { name: 'city', label: 'Ort', type: 'text', half: true, list: true },
      { name: 'contact_person', label: 'Ansprechpartner vor Ort', type: 'text' },
      { name: 'contact_phone', label: 'Telefon vor Ort', type: 'tel' },
      { name: 'area_sqm', label: 'Fläche (m²)', type: 'number', third: true },
      { name: 'floors', label: 'Etagen', type: 'number', third: true },
      { name: 'rooms', label: 'Räume', type: 'number', third: true },
      { name: 'cleaning_interval', label: 'Reinigungsintervall', type: 'text', placeholder: 'z. B. Mo, Mi, Fr ab 18 Uhr' },
      { name: 'access_notes', label: 'Zugangs- und Sicherheitshinweise', type: 'textarea', sensitive: true, help: 'Wird nur berechtigten Mitarbeitern angezeigt. Keine Alarmcodes im Klartext hinterlegen.' },
      { name: 'contract_info', label: 'Vertragsinformationen', type: 'textarea', perm: 'customers.read' },
      { name: 'notes', label: 'Notizen', type: 'textarea' },
    ],
  },
  materials: {
    label: 'Artikel', plural: 'Material', table: 'materials', numberField: 'article_no',
    read: 'materials.read', write: 'materials.write', archivable: true,
    title: (r) => r.name, subtitle: (r) => [r.article_no, r.location].filter(Boolean).join(' · '),
    search: ['article_no', 'barcode', 'name', 'supplier', 'location'],
    fields: [
      { name: 'name', label: 'Bezeichnung', type: 'text', required: true, list: true },
      { name: 'category', label: 'Kategorie', type: 'select', options: opt({ reinigungsmittel: 'Reinigungsmittel', verbrauchsmaterial: 'Verbrauchsmaterial', werkzeug: 'Werkzeug', arbeitskleidung: 'Arbeitskleidung', ersatzteil: 'Ersatzteil', inventar: 'Inventar' }), required: true, default: 'verbrauchsmaterial', list: true },
      { name: 'article_no', label: 'Artikelnummer', type: 'text', help: 'Leer lassen für automatische Vergabe.' },
      { name: 'barcode', label: 'Barcode / EAN', type: 'text', scan: true },
      { name: 'unit', label: 'Einheit', type: 'text', default: 'Stück', half: true },
      { name: 'min_stock', label: 'Mindestbestand', type: 'number', half: true, default: 0 },
      { name: 'stock', label: 'Anfangsbestand', type: 'number', createOnly: true, default: 0, help: 'Spätere Änderungen nur über Bestandsbewegungen.' },
      { name: 'purchase_price', label: 'Einkaufspreis (€)', type: 'money', half: true },
      { name: 'supplier', label: 'Lieferant', type: 'text', half: true },
      { name: 'location', label: 'Lagerort', type: 'text' },
      { name: 'notes', label: 'Notizen', type: 'textarea' },
    ],
  },
  machines: {
    label: 'Maschine', plural: 'Maschinen', table: 'machines', numberField: 'inventory_no',
    read: 'machines.read', write: 'machines.write', archivable: true,
    title: (r) => r.name, subtitle: (r) => [r.inventory_no, r.manufacturer, r.model].filter(Boolean).join(' · '),
    search: ['inventory_no', 'name', 'manufacturer', 'model', 'serial_no', 'location'],
    fields: [
      { name: 'name', label: 'Bezeichnung', type: 'text', required: true, list: true },
      { name: 'inventory_no', label: 'Inventarnummer', type: 'text', help: 'Leer lassen für automatische Vergabe.' },
      { name: 'manufacturer', label: 'Hersteller', type: 'text', half: true },
      { name: 'model', label: 'Modell', type: 'text', half: true },
      { name: 'serial_no', label: 'Seriennummer', type: 'text', scan: true },
      { name: 'purchase_date', label: 'Kaufdatum', type: 'date', half: true },
      { name: 'purchase_price', label: 'Kaufpreis (€)', type: 'money', half: true },
      { name: 'condition', label: 'Zustand', type: 'select', options: opt({ neu: 'Neu', gut: 'Gut', gebraucht: 'Gebraucht', defekt: 'Defekt', in_reparatur: 'In Reparatur', ausgemustert: 'Ausgemustert' }), default: 'gut', list: true },
      { name: 'location', label: 'Standort', type: 'text' },
      { name: 'responsible_user_id', label: 'Verantwortlicher Mitarbeiter', type: 'ref', ref: 'users' },
      { name: 'maintenance_interval_days', label: 'Wartungsintervall (Tage)', type: 'number', half: true },
      { name: 'next_maintenance', label: 'Nächste Wartung', type: 'date', half: true, list: true },
      { name: 'notes', label: 'Notizen', type: 'textarea' },
    ],
  },
  winter_areas: {
    label: 'Einsatzfläche', plural: 'Einsatzflächen', table: 'winter_areas',
    read: 'winter.read', write: 'winter.write', deletable: true,
    title: (r) => r.name,
    fields: [
      { name: 'object_id', label: 'Objekt', type: 'ref', ref: 'objects', required: true },
      { name: 'kind', label: 'Art', type: 'select', options: opt({ gehweg: 'Gehweg', einfahrt: 'Einfahrt', parkplatz: 'Parkplatz', zugang: 'Hauszugang', treppe: 'Außentreppe', sonstige: 'Sonstige Fläche' }), default: 'gehweg' },
      { name: 'name', label: 'Bezeichnung', type: 'text', required: true },
      { name: 'area_sqm', label: 'Fläche (m²)', type: 'number', half: true },
      { name: 'priority', label: 'Priorität (1 = zuerst)', type: 'number', half: true, default: 1 },
      { name: 'notes', label: 'Hinweise', type: 'textarea' },
    ],
  },
  winter_standby: {
    label: 'Bereitschaft', plural: 'Bereitschaftszeiten', table: 'winter_standby',
    read: 'winter.read', write: 'winter.write', deletable: true,
    title: (r) => 'Bereitschaft',
    fields: [
      { name: 'user_id', label: 'Mitarbeiter', type: 'ref', ref: 'users', required: true },
      { name: 'start_at', label: 'Beginn', type: 'datetime', required: true },
      { name: 'end_at', label: 'Ende', type: 'datetime', required: true },
      { name: 'note', label: 'Notiz', type: 'text' },
    ],
  },
  checklist_templates: {
    label: 'Checkliste', plural: 'Checklisten', table: 'checklist_templates',
    read: 'orders.read', write: 'checklists.manage',
    title: (r) => r.name,
    fields: [
      { name: 'name', label: 'Bezeichnung', type: 'text', required: true, list: true },
      { name: 'service_id', label: 'Dienstleistung', type: 'ref', ref: 'services' },
      { name: 'purpose', label: 'Verwendung', type: 'select', options: opt({ reinigung: 'Auftrags-Checkliste', kontrolle: 'Qualitätskontrolle' }), default: 'reinigung' },
      { name: 'active', label: 'Aktiv', type: 'bool', default: 1 },
    ],
  },
  recurrences: {
    label: 'Serienauftrag', plural: 'Serienaufträge', table: 'recurrences',
    read: 'orders.read', write: 'orders.write',
    title: (r) => 'Serienauftrag',
    fields: [],
  },
  defects: {
    label: 'Mangel', plural: 'Mängel & Reklamationen', table: 'defects', numberField: 'defect_no',
    read: 'quality.read', write: 'quality.write',
    title: (r) => r.title,
    fields: [
      { name: 'kind', label: 'Art', type: 'select', options: opt(DEFECT_KINDS), default: 'mangel' },
      { name: 'status', label: 'Status', type: 'select', options: opt(DEFECT_STATUS) },
    ],
  },
  winter_operations: {
    label: 'Winterdiensteinsatz', plural: 'Winterdiensteinsätze', table: 'winter_operations', numberField: 'operation_no',
    read: 'winter.read', write: 'winter.write',
    title: (r) => r.operation_no || 'Einsatz',
    fields: [
      { name: 'weather', label: 'Wetter', type: 'select', options: opt(WINTER_WEATHER) },
      { name: 'activity', label: 'Tätigkeit', type: 'select', options: opt(WINTER_ACTIVITIES) },
    ],
  },
};

// Tabellen, die per Delta-Sync auf die Geräte repliziert werden.
export const SYNC_TABLES = [
  'users', 'customers', 'contact_history', 'services', 'customer_services', 'objects', 'object_employees',
  'qr_codes', 'checklist_templates', 'checklist_template_items', 'recurrences', 'orders', 'order_checklist_items',
  'photos', 'time_entries', 'time_corrections', 'materials', 'stock_movements', 'machines', 'machine_events',
  'inspections', 'inspection_items', 'defects', 'defect_log', 'winter_areas', 'winter_standby', 'winter_operations',
  'documents', 'scans',
];
