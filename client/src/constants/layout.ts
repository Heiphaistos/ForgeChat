// Bornes de largeur de la sidebar (canaux/DM) -- partagées entre MainLayout.tsx
// (applique le clamp au resize) et AppearanceSection.tsx (slider Settings) pour
// qu'elles ne puissent plus diverger silencieusement.
//
// SIDEBAR_MIN/DEFAULT doivent rester assez larges pour UserPanel (avatar + nom +
// statut + 7 boutons d'action, ~244px incompressibles même après réduction du
// padding des boutons) -- en dessous, les boutons (flex-shrink-0, ne rétrécissent
// jamais) réduisent le nom d'utilisateur à une largeur de 0px.
export const SIDEBAR_MIN = 280
export const SIDEBAR_MAX = 400
export const SIDEBAR_DEFAULT = 300
