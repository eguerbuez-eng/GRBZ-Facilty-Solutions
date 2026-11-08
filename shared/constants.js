// Gemeinsame Konstanten für Server und Client (ES-Modul).

export const APP_NAME = 'GRBZ Facility Management System';
export const COMPANY = 'GRBZ Facility Solutions';
export const TIMEZONE = 'Europe/Berlin';

// Standardrollen (Ausgangszustand). Rollen und Rechte sind über die Oberfläche
// änderbar und werden in der Tabelle `roles` gespeichert.
export const ROLES = {
  admin: 'Administrator',
  geschaeftsfuehrer: 'Geschäftsführer',
  objektleiter: 'Objektleiter',
  vorarbeiter: 'Vorarbeiter',
  mitarbeiter: 'Mitarbeiter',
  minijobber: 'Minijobber',
  aushilfe: 'Aushilfe',
  kunde: 'Kunde (Portal)',
};

const ALL = [
  'dashboard.view',
  'customers.read', 'customers.write',
  'objects.read', 'objects.write',
  'qr.manage', 'qr.scan',
  'orders.read', 'orders.write', 'orders.execute',
  'checklists.manage',
  'photos.read', 'photos.write', 'photos.release',
  'users.read', 'users.manage',
  'time.own', 'time.all', 'time.approve',
  'materials.read', 'materials.write', 'materials.consume',
  'machines.read', 'machines.write',
  'quality.read', 'quality.write', 'defects.report',
  'winter.read', 'winter.write', 'winter.execute',
  'documents.read', 'documents.write',
  'reports.create',
  'audit.read',
  'settings.manage',
  'hr.read', 'hr.manage', 'hr.salary', 'hr.rules', 'roles.manage',
  'planning.manage', 'shifts.own', 'absences.request', 'absences.manage',
];

export const PERMISSION_LABELS = {
  'dashboard.view': 'Dashboard ansehen',
  'customers.read': 'Kunden ansehen', 'customers.write': 'Kunden bearbeiten',
  'objects.read': 'Objekte ansehen', 'objects.write': 'Objekte bearbeiten',
  'qr.manage': 'QR-Codes verwalten', 'qr.scan': 'QR-Codes scannen',
  'orders.read': 'Aufträge ansehen', 'orders.write': 'Aufträge planen', 'orders.execute': 'Aufträge ausführen',
  'checklists.manage': 'Checklisten bearbeiten',
  'photos.read': 'Fotos ansehen', 'photos.write': 'Fotos aufnehmen', 'photos.release': 'Fotos für Kunden freigeben',
  'users.read': 'Mitarbeiter ansehen', 'users.manage': 'Mitarbeiter verwalten',
  'time.own': 'Eigene Zeiterfassung', 'time.all': 'Alle Arbeitszeiten ansehen', 'time.approve': 'Zeitkorrekturen genehmigen',
  'materials.read': 'Material ansehen', 'materials.write': 'Material verwalten', 'materials.consume': 'Materialverbrauch buchen',
  'machines.read': 'Maschinen ansehen', 'machines.write': 'Maschinen verwalten',
  'quality.read': 'Qualität ansehen', 'quality.write': 'Qualitätskontrollen durchführen', 'defects.report': 'Mängel melden',
  'winter.read': 'Winterdienst ansehen', 'winter.write': 'Winterdienst verwalten', 'winter.execute': 'Winterdiensteinsätze dokumentieren',
  'documents.read': 'Dokumente ansehen', 'documents.write': 'Dokumente verwalten',
  'reports.create': 'Berichte erstellen',
  'audit.read': 'Protokoll einsehen',
  'settings.manage': 'Systemeinstellungen',
  'hr.read': 'Personalakten ansehen', 'hr.manage': 'Personalakten bearbeiten', 'hr.salary': 'Löhne, Gehälter und Personalkosten',
  'hr.rules': 'Berechnungsmodelle verwalten', 'roles.manage': 'Rollen und Rechte verwalten',
  'planning.manage': 'Dienst- und Schichtplanung', 'shifts.own': 'Eigenen Dienstplan ansehen',
  'absences.request': 'Eigene Abwesenheiten beantragen', 'absences.manage': 'Abwesenheiten genehmigen und erfassen',
};

export const PERMISSION_GROUPS = [
  ['Allgemein', ['dashboard.view', 'reports.create', 'audit.read', 'settings.manage']],
  ['Kunden & Objekte', ['customers.read', 'customers.write', 'objects.read', 'objects.write', 'qr.manage', 'qr.scan', 'documents.read', 'documents.write']],
  ['Aufträge', ['orders.read', 'orders.write', 'orders.execute', 'checklists.manage', 'photos.read', 'photos.write', 'photos.release']],
  ['Personal', ['users.read', 'users.manage', 'roles.manage', 'hr.read', 'hr.manage', 'hr.salary', 'hr.rules', 'planning.manage', 'shifts.own', 'absences.request', 'absences.manage']],
  ['Zeiterfassung', ['time.own', 'time.all', 'time.approve']],
  ['Material & Maschinen', ['materials.read', 'materials.write', 'materials.consume', 'machines.read', 'machines.write']],
  ['Qualität & Winterdienst', ['quality.read', 'quality.write', 'defects.report', 'winter.read', 'winter.write', 'winter.execute']],
];

export const ROLE_PERMISSIONS = {
  admin: ALL,
  geschaeftsfuehrer: ALL.filter((p) => p !== 'settings.manage'),
  objektleiter: [
    'dashboard.view', 'customers.read', 'objects.read', 'objects.write', 'qr.manage', 'qr.scan',
    'orders.read', 'orders.write', 'orders.execute', 'checklists.manage',
    'photos.read', 'photos.write', 'photos.release', 'users.read',
    'time.own', 'time.all', 'time.approve',
    'materials.read', 'materials.write', 'materials.consume',
    'machines.read', 'machines.write',
    'quality.read', 'quality.write', 'defects.report',
    'winter.read', 'winter.write', 'winter.execute',
    'documents.read', 'documents.write', 'reports.create',
    'hr.read', 'planning.manage', 'shifts.own', 'absences.request', 'absences.manage',
  ],
  vorarbeiter: [
    'dashboard.view', 'objects.read', 'qr.scan', 'orders.read', 'orders.execute', 'users.read',
    'photos.read', 'photos.write', 'time.own', 'materials.read', 'materials.consume',
    'machines.read', 'quality.read', 'quality.write', 'defects.report', 'winter.read', 'winter.execute', 'reports.create',
    'shifts.own', 'absences.request',
  ],
  mitarbeiter: [
    'dashboard.view', 'objects.read', 'qr.scan', 'orders.read', 'orders.execute',
    'photos.read', 'photos.write', 'time.own', 'materials.read', 'materials.consume',
    'machines.read', 'defects.report', 'winter.read', 'winter.execute', 'reports.create',
    'shifts.own', 'absences.request',
  ],
  minijobber: [
    'dashboard.view', 'objects.read', 'qr.scan', 'orders.read', 'orders.execute',
    'photos.read', 'photos.write', 'time.own', 'materials.read', 'materials.consume', 'defects.report',
    'winter.read', 'winter.execute', 'shifts.own', 'absences.request',
  ],
  aushilfe: [
    'dashboard.view', 'objects.read', 'qr.scan', 'orders.read', 'orders.execute',
    'photos.read', 'photos.write', 'time.own', 'materials.consume', 'materials.read', 'defects.report', 'shifts.own',
  ],
  kunde: [],
};

// Rollen, die nur zugeordnete Objekte/Aufträge sehen (Standard; je Rolle einstellbar).
export const SCOPED_ROLES = ['vorarbeiter', 'mitarbeiter', 'minijobber', 'aushilfe'];

/** Berechtigung prüfen. user.permissions (aus der Rollen-Tabelle) hat Vorrang. */
export function can(user, perm) {
  if (!user) return false;
  const perms = Array.isArray(user.permissions) ? user.permissions : ROLE_PERMISSIONS[user.role] || [];
  return perms.includes(perm);
}

export const DEFAULT_EMPLOYMENT_TYPES = ['Geschäftsführer', 'Vollzeit', 'Teilzeit', 'Minijobber', 'Midijobber', 'Werkstudent', 'Aushilfe', 'Saisonkraft', 'Befristet', 'Sonstige'];
export const DEFAULT_POSITIONS = ['Geschäftsführer', 'Administrator', 'Bereichsleiter', 'Objektleiter', 'Vorarbeiter', 'Reinigungskraft', 'Glasreiniger', 'Hausmeister', 'Gartenpflege', 'Winterdienst', 'Springer', 'Verwaltung'];
export const DEFAULT_DEPARTMENTS = ['Verwaltung', 'Unterhaltsreinigung', 'Glasreinigung', 'Hausmeisterservice', 'Winterdienst'];

export const EMPLOYEE_STATUS = {
  aktiv: 'Aktiv', probezeit: 'Probezeit', beurlaubt: 'Beurlaubt', elternzeit: 'Elternzeit',
  langzeitkrank: 'Langzeiterkrankt', ausgeschieden: 'Ausgeschieden', inaktiv: 'Inaktiv',
};
export const PAY_TYPES = { stunde: 'Stundenlohn', monat: 'Monatsgehalt', keine: 'Keine Vergütung hinterlegt' };

export const ABSENCE_KINDS = {
  urlaub: 'Urlaub', krank: 'Krankheit', kind_krank: 'Kind krank', sonderurlaub: 'Sonderurlaub',
  unbezahlt: 'Unbezahlter Urlaub', schulung: 'Schulung / Weiterbildung', ueberstundenabbau: 'Überstundenabbau', sonstiges: 'Sonstiges',
};
export const ABSENCE_STATUS = { beantragt: 'Beantragt', genehmigt: 'Genehmigt', abgelehnt: 'Abgelehnt', storniert: 'Storniert' };

export const SHIFT_STATUS = { geplant: 'Geplant', bestaetigt: 'Bestätigt', abgesagt: 'Abgesagt' };

export const ORDER_STATUS = {
  geplant: 'Geplant',
  in_bearbeitung: 'In Bearbeitung',
  abgeschlossen: 'Abgeschlossen',
  unterbrochen: 'Unterbrochen',
  mangel: 'Mangel festgestellt',
};

export const CHECK_RESULTS = {
  offen: 'Offen',
  erledigt: 'Erledigt',
  nicht_erledigt: 'Nicht erledigt',
  nicht_zutreffend: 'Nicht zutreffend',
  mangel: 'Mangel festgestellt',
};

export const FREQUENCIES = {
  taeglich: 'Täglich (Mo–Fr)',
  taeglich_alle: 'Täglich (inkl. Wochenende)',
  zweimal_woechentlich: 'Zweimal wöchentlich',
  woechentlich: 'Wöchentlich',
  zweiwoechentlich: 'Zweiwöchentlich',
  monatlich: 'Monatlich',
  individuell: 'Individuell (alle X Tage / Wochentage)',
};

export const WEEKDAYS = { 1: 'Mo', 2: 'Di', 3: 'Mi', 4: 'Do', 5: 'Fr', 6: 'Sa', 0: 'So' };

export const PHOTO_CATEGORIES = {
  vorher: 'Vorher',
  nachher: 'Nachher',
  schaden: 'Schaden',
  mangel: 'Mangel',
  sonstiges: 'Sonstiges',
};

export const QR_AREA_TYPES = {
  eingang: 'Gebäudeeingang',
  treppenhaus: 'Treppenhaus',
  keller: 'Keller',
  dachboden: 'Dachboden',
  aussenanlage: 'Außenanlage',
  muellplatz: 'Müllplatz',
  technikraum: 'Technikraum',
  sanitaer: 'Sanitärbereich',
  buero: 'Büro',
  sonstiges: 'Sonstiger Bereich',
};

export const QR_TARGET_TYPES = {
  object: 'Objekt',
  area: 'Bereich',
  machine: 'Maschine',
  material: 'Inventar / Material',
};

export const DEFECT_STATUS = {
  offen: 'Offen',
  in_bearbeitung: 'In Bearbeitung',
  behoben: 'Behoben',
  abgenommen: 'Abgenommen',
  verworfen: 'Verworfen',
};

export const DEFECT_KINDS = { mangel: 'Mangel', reklamation: 'Reklamation', schaden: 'Schaden' };

export const WINTER_WEATHER = {
  schneefall: 'Schneefall',
  glaette: 'Glätte',
  eisregen: 'Eisregen',
  reifglaette: 'Reifglätte',
  schneeverwehung: 'Schneeverwehung',
  kontrolle: 'Kontrollgang (trocken)',
};

export const WINTER_ACTIVITIES = {
  geraeumt: 'Geräumt',
  gestreut: 'Gestreut',
  geraeumt_gestreut: 'Geräumt und gestreut',
  kontrolliert: 'Kontrolliert, kein Einsatz nötig',
};

export const TIME_CORRECTION_STATUS = { beantragt: 'Beantragt', genehmigt: 'Genehmigt', abgelehnt: 'Abgelehnt' };

export const DEFAULT_SERVICES = [
  'Unterhaltsreinigung', 'Büroreinigung', 'Praxisreinigung', 'Kita-Reinigung', 'Treppenhausreinigung',
  'Glas- und Fensterreinigung', 'Grundreinigung', 'Granitbodenreinigung', 'Hausmeisterservice',
  'Gartenpflege', 'Entrümpelung', 'Abrissarbeiten', 'Graffitientfernung', 'Winterdienst',
];

export const DEFAULT_CHECKLISTS = {
  Unterhaltsreinigung: ['Böden reinigen', 'Oberflächen abwischen', 'Mülleimer leeren', 'Sanitäranlagen reinigen', 'Spiegel reinigen', 'Verbrauchsmaterial auffüllen'],
  Treppenhausreinigung: ['Eingangsbereich reinigen', 'Treppenstufen reinigen', 'Geländer reinigen', 'Handläufe reinigen', 'Spinnweben entfernen', 'Briefkastenanlage kontrollieren'],
  Büroreinigung: ['Schreibtische nach Vorgabe reinigen', 'Böden reinigen', 'Papierkörbe leeren', 'Küche reinigen', 'Sanitäranlagen reinigen'],
  'Kita-Reinigung': ['Gruppenräume reinigen', 'Tische und Kontaktflächen reinigen', 'Böden reinigen', 'Sanitärbereiche reinigen', 'Abfallbehälter leeren'],
  Hausmeisterservice: ['Außenanlage kontrollieren', 'Müllplatz prüfen', 'Beleuchtung kontrollieren', 'Schäden dokumentieren', 'Allgemeine Objektkontrolle'],
};

export const DEFAULT_INSPECTION_ITEMS = [
  'Böden sauber und streifenfrei', 'Oberflächen staubfrei', 'Sanitärbereiche hygienisch einwandfrei',
  'Abfallbehälter geleert', 'Verbrauchsmaterial vorhanden', 'Gesamteindruck',
];
