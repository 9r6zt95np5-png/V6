# TabletTracking Industrial Suite v2.0.1

PWA offline per il monitoraggio di quattro macchine di produzione.

## Pubblicazione su GitHub Pages

1. Carica nella radice della repository tutti i file contenuti in questo archivio.
2. Sovrascrivi i file della versione precedente.
3. In **Settings → Pages** seleziona la branch principale e la cartella `/root`.
4. Attendi l'aggiornamento di GitHub Pages e riapri la PWA.

## Novità v2.0

- Interfaccia industriale professionale.
- Menu completo: Dashboard, Macchine, Prodotti, Avvisi, Turno, Backup, Impostazioni e Info.
- Quattro temi: Clean Light, Industrial Dark, Blue Control e Compact Operator.
- Dashboard KPI con stato macchina e attività prioritarie.
- Migrazione automatica dei dati salvati dalle versioni 1.x.
- Funzionamento offline tramite service worker.


## Correzione v2.0.1

- Il tempo macchina degli avvisi può superare 99 ore.
- Sono accettati valori come `100:00:00`, `125:30:00` e superiori.
- Minuti e secondi restano limitati correttamente da 00 a 59.
