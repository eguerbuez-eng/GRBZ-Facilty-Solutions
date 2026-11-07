// Gemeinsame Konstanten für Server und Client (ES-Modul).

export const APP_NAME = 'GRBZ Facility Management System';
export const COMPANY = 'GRBZ Facility Solutions';
export const TIMEZONE = 'Europe/Berlin';

export const ROLES = {
  admin: 'Administrator',
  geschaeftsfuehrer: 'Geschäftsführer',
  objektleiter: 'Objektleiter',
  mitarbeiter: 'Mitarbeiter',
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
};

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
  ],
  mitarbeiter: [
    'dashboard.view', 'objects.read', 'qr.scan', 'orders.read', 'orders.execute',
    'photos.read', 'photos.write', 'time.own', 'materials.read', 'materials.consume',
    'machines.read', 'defects.report', 'winter.read', 'winter.execute', 'reports.create',
  ],
  kunde: [],
};

// Mitarbeiter sehen nur zugeordnete Objekte/Aufträge (Zeilenfilter serverseitig).
export const SCOPED_ROLES = ['mitarbeiter'];

export function can(user, perm) {
  if (!user) return false;
  return (ROLE_PERMISSIONS[user.role] || []).includes(perm);
}

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
