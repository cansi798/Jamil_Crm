# CRM UI Modernisierung – Designkonzept

## Design-Prinzipien
- **Smart & klar**: Weniger ist mehr – jede Information hat ihren Platz
- **Mobil zuerst**: Craftsmen nutzen das Handy auf der Baustelle
- **Professionell**: Seriös für Kunden, aber nicht langweilig
- **Hoher Kontrast**: Gut lesbar bei Sonnenlicht

## Farbpalette
| Farbe | Hex | Verwendung |
|-------|-----|------------|
| Primär | `#1e40af` | Buttons, Links, aktive Elemente (kräftiges Blau) |
| Primär dunkel | `#1e3a8a` | Hover, Akzente |
| Primär hell | `#eff6ff` | Hintergründe, Tags |
| Erfolg | `#059669` | Bestätigungen, positive Status |
| Warnung | `#d97706` | Warnungen, ausstehend |
| Fehler | `#dc2626` | Fehler, Gefahr |
| Text | `#111827` | Fließtext (fast schwarz) |
| Text leise | `#6b7280` | Sekundäre Informationen |
| Rand | `#e5e7eb` | Trennlinien, Karten-Ränder |
| Fläche | `#ffffff` | Karten, Formulare |
| Hintergrund | `#f9fafb` | Seitenhintergrund |

## Typografie
- **Schriftfamilie**: `Inter` (modern, gut lesbar, für UI optimiert)
- **Größen**:
  - H1: 1.875rem (30px) – Seitentitel
  - H2: 1.5rem (24px) – Abschnitte
  - H3: 1.25rem (20px) – Unterabschnitte
  - Body: 1rem (16px) – Standard
  - Klein: 0.875rem (14px) – Metadaten
  - Mini: 0.75rem (12px) – Labels

## Layout-Konzept
- **Karten-basiert**: Informationen in klaren Karten mit subtilen Schatten
- **Großzügiger Weißraum**: Luftig, nicht gedrängt
- **Klare Hierarchie**: Größen und Farben leiten das Auge
- **Abgerundete Ecken**: 0.75rem (12px) für Karten, 0.5rem (8px) für Buttons

## Komponenten-Design

### Buttons
- **Primär**: Gefüllt, blau, abgerundet, Hover: dunkler
- **Sekundär**: Weiß mit blauem Rand, Hover: heller Hintergrund
- **Gefahr**: Rot, nur für Lösch-Aktionen
- **Größe**: Kompakt aber groß genug zum Tippen (44px min)

### Karten
- Weißer Hintergrund
- Dezenter Schatten: `0 1px 3px rgba(0,0,0,0.1)`
- Abgerundete Ecken: 12px
- Padding: 1.5rem

### Navigation
- **Mobil**: Untere Leiste, Icons + Text
- **Desktop**: Linke Seitenleiste, Icons + Text
- Aktiv: Blauer Hintergrund, weißer Text

### Formulare
- Klare Labels über den Feldern
- Fokus: Blauer Rand mit Glow
- Fehler: Roter Rand + Nachricht
- Platzhalter: Helles Grau

## Besondere Elemente

### Status-Badges
- Farbcodierte Tags für Auftrags-Status
- Abgerundet, kompakt, gut lesbar

### Leere Zustände
- Freundliche Nachrichten
- Klare Handlungsaufforderung (CTA)

### Lade-Zustände
- Dezente Spinner
- Skeleton-Loader für Listen

## Responsive Verhalten
- **< 640px**: Einzeilig, volle Breite
- **640-1024px**: Zwei Spalten wo möglich
- **> 1024px**: Drei Spalten, Sidebar-Navigation

## Zugänglichkeit
- Kontrast-Verhältnis mindestens 4.5:1
- Fokus-Indikatoren sichtbar
- Touch-Ziele mindestens 44x44px
- Screenreader-freundliche Labels