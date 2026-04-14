# Firebase Deploy

## 1. Popuni project ID

Kopiraj `.firebaserc.example` u `.firebaserc` i zamijeni:

`your-firebase-project-id`

sa stvarnim Firebase project ID-om.

## 2. Popuni frontend config

Uredi `firebase-config.js` i zalijepi svoj Web app config iz Firebase konzole.

## 3. Prijava u Firebase CLI

```bash
firebase login
```

## 4. Poveži projekat

Ako već imaš `.firebaserc`, dovoljno je:

```bash
firebase use --add
```

ili ručno ostavi `.firebaserc` sa tačnim project ID-om.

## 5. Deploy pravila i hosting

```bash
firebase deploy --only firestore:rules,firestore:indexes,hosting
```

## 6. Samo hosting

```bash
firebase deploy --only hosting
```

## Napomena

- `firebase.json` koristi korijen projekta kao hosting public folder, što odgovara ovom statičkom sajtu.
- `firestore.rules` i `firestore.indexes.json` su već povezani kroz `firebase.json`.
- Ako ne želiš deploy indeksa, možeš koristiti:

```bash
firebase deploy --only firestore:rules,hosting
```
