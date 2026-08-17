const fs = require('fs');
const path = 'd:/PAGINAS WEB/wacrm/messages';
const en = JSON.parse(fs.readFileSync(path + '/en.json', 'utf8'));
const es = JSON.parse(fs.readFileSync(path + '/es.json', 'utf8'));

function merge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      merge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

function translateString(s) {
  if (typeof s !== 'string') return s;
  const map = [
    [/^Save$/g, 'Guardar'],
    [/^Saving\.\.\.$/g, 'Guardando…'],
    [/^Saving…$/g, 'Guardando…'],
    [/^Cancel$/g, 'Cancelar'],
    [/^Delete$/g, 'Eliminar'],
    [/^Edit$/g, 'Editar'],
    [/^Create$/g, 'Crear'],
    [/^Add$/g, 'Agregar'],
    [/^Remove$/g, 'Quitar'],
    [/^Loading…$/g, 'Cargando…'],
    [/^Loading\.\.\.$/g, 'Cargando…'],
    [/^Active$/g, 'Activo'],
    [/^Connected$/g, 'Conectado'],
    [/^Disconnected$/g, 'Desconectado'],
    [/^Not authenticated$/g, 'No autenticado'],
    [/^You$/g, 'Tú'],
    [/^Unnamed$/g, 'Sin nombre'],
    [/^online$/g, 'en línea'],
    [/^away$/g, 'ausente'],
    [/^offline$/g, 'desconectado'],
    [/^Revoked$/g, 'Revocada'],
    [/^Expired$/g, 'Expirada'],
    [/^Team members$/g, 'Miembros del equipo'],
    [/^Invite member$/g, 'Invitar miembro'],
    [/^Pending invitations$/g, 'Invitaciones pendientes'],
    [/^API keys$/g, 'Claves API'],
    [/^New API key$/g, 'Nueva clave API'],
    [/^No API keys yet\.$/g, 'Aún no hay claves API.'],
    [/^Templates$/g, 'Plantillas'],
    [/^Quick replies$/g, 'Respuestas rápidas'],
    [/^Failed to /g, 'No se pudo '],
  ];
  let out = s;
  for (const [re, rep] of map) out = out.replace(re, rep);
  return out;
}

function deepTranslate(node) {
  if (typeof node === 'string') return translateString(node);
  if (Array.isArray(node)) return node.map(deepTranslate);
  if (node && typeof node === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(node)) o[k] = deepTranslate(v);
    return o;
  }
  return node;
}

const settingsEs = {
  pageTitle: 'Configuración',
  pageDesc:
    'Todo en un solo lugar: tu cuenta y tu espacio de trabajo. Elige una sección.',
  overview: {
    notSetup: 'Sin configurar',
    connected: 'Conectado',
    needsReconnecting: 'Necesita reconectar',
    viewTeamMembers: 'Ver miembros del equipo',
    membersCount:
      '{count} {count, plural, =1 {miembro} other {miembros}}',
    pendingInvites:
      '{count} {count, plural, =1 {invitación pendiente} other {invitaciones pendientes}}',
    manageTemplates: 'Gestionar plantillas',
    templatesCount:
      '{count} {count, plural, =1 {plantilla} other {plantillas}}',
    pendingReview: '{count} en revisión',
    tagsAndFields: 'Etiquetas y campos',
    tagsCount:
      '{count} {count, plural, =1 {etiqueta} other {etiquetas}}',
    fieldsCount: '{count} {count, plural, =1 {campo} other {campos}}',
    appearance: 'Modo {mode} · acento {theme}',
    yourAccount: 'Tu cuenta',
    loading: 'Cargando…',
  },
  deals: {
    title: 'Deals y moneda',
    description:
      'La moneda usada en deals nuevos y en los totales del embudo y del panel.',
    defaultCurrency: 'Moneda predeterminada',
    defaultCurrencyDesc:
      'Los deals nuevos usan esta moneda, y los totales del embudo y del panel se muestran en ella. Los deals existentes conservan la moneda con la que se guardaron.',
    currencyLabel: 'Moneda',
    adminOnlyHint:
      'Solo los administradores de la cuenta pueden cambiar la moneda predeterminada.',
    save: 'Guardar',
    saving: 'Guardando…',
    saveFailed: 'No se pudo guardar la moneda predeterminada',
    saveSuccess: 'Moneda predeterminada actualizada',
  },
  tagsAndFields: {
    title: 'Campos y etiquetas',
    description:
      'Dos formas de organizar contactos: etiquetas de color para agrupar rápido, y campos personalizados para datos estructurados.',
    tagsTitle: 'Etiquetas',
    tagsDesc: 'Etiquetas de color para agrupar y filtrar contactos.',
    fieldsTitle: 'Campos personalizados',
    fieldsDesc:
      'Campos extra del contacto (p. ej. código postal, origen del lead). Aparecen en cada contacto y en la acción de automatización “Actualizar campo de contacto”.',
    adminRole: 'Admin',
    failedToLoadTags: 'No se pudieron cargar las etiquetas',
    nameRequired: 'El nombre de la etiqueta es obligatorio',
    notAuthenticated: 'No autenticado',
    tagCreated: 'Etiqueta creada',
    failedToCreateTag: 'No se pudo crear la etiqueta',
    tagDeleted: 'Etiqueta eliminada',
    failedToDeleteTag: 'No se pudo eliminar la etiqueta',
    deleteAria: 'Eliminar {name}',
    noTags: 'Aún no hay etiquetas — crea la primera abajo.',
    placeholder: 'p. ej. Newsletter',
    useColor: 'Usar {color}',
    addTag: 'Agregar etiqueta',
    deleteTag: 'Eliminar etiqueta',
    deleteConfirm:
      '¿Eliminar la etiqueta "{name}"? Se quitará de todos los contactos y no se puede deshacer.',
    cancel: 'Cancelar',
    deleting: 'Eliminando…',
    colors: {
      red: 'Rojo',
      orange: 'Naranja',
      amber: 'Ámbar',
      emerald: 'Esmeralda',
      cyan: 'Cian',
      blue: 'Azul',
      violet: 'Violeta',
      pink: 'Rosa',
    },
  },
  profile: {
    title: 'Tu perfil',
    description:
      'Cómo apareces en la app. Tu avatar y nombre se muestran en el encabezado, la barra lateral y donde te vean tus compañeros.',
    changePhoto: 'Cambiar foto',
    uploadPhoto: 'Subir foto',
    remove: 'Quitar',
    photoHint: 'PNG, JPG, WebP o GIF. Hasta 2 MB.',
    displayName: 'Nombre para mostrar',
    email: 'Correo',
    emailChangeHint:
      'Revisa la bandeja de <bold>{oldEmail}</bold> y <bold>{newEmail}</bold>: ambos deben confirmar antes de que el cambio surta efecto.',
    accountDetails: 'Detalles de la cuenta',
    role: 'Rol',
    joined: 'Se unió',
    userId: 'ID de usuario',
    loading: 'Cargando tu perfil…',
    saving: 'Guardando…',
    saveChanges: 'Guardar cambios',
    unsupportedImage: 'Tipo de imagen no admitido',
    unsupportedImageDesc: 'Usa PNG, JPG, WebP o GIF.',
    imageTooLarge: 'La imagen es demasiado grande',
    imageTooLargeDesc: 'Máximo 2 MB.',
    nameRequired: 'El nombre para mostrar es obligatorio',
    invalidEmail: 'Introduce un correo válido',
    toastUpdated: 'Perfil actualizado',
    toastUpdateFailed: 'No se pudo actualizar el perfil',
    uploadFailed: 'Error al subir: {message}',
  },
  security: {
    title: 'Inicio de sesión y seguridad',
    description:
      'Cambia tu contraseña y cierra sesión en tus dispositivos. Esto mantiene tu cuenta segura.',
  },
  appearance: {
    title: 'Apariencia',
    description:
      'Modo, color de acento e idioma de la interfaz. El modo y el tema se guardan en este dispositivo; el idioma, en este navegador.',
    mode: 'Modo',
    useMode: 'Usar modo {mode}',
    active: 'Activo',
    accentColor: 'Color de acento',
    useTheme: 'Usar tema {name}',
    language: 'Idioma',
    languageDesc:
      'Cambia el idioma de la interfaz. Se guarda en este navegador.',
    languageUpdated: 'Idioma actualizado',
  },
  branding: {
    title: 'Marca blanca',
    description: 'Nombre y logo de tu empresa en el menú lateral.',
    companyName: 'Nombre de la empresa',
    companyNameDesc:
      'Se muestra en la barra lateral en lugar del nombre del producto.',
    companyNamePlaceholder: 'Ej. ALTATERRA',
    logo: 'Logo',
    logoDesc: 'PNG, JPG, WebP o SVG. Máximo 2 MB.',
    uploadLogo: 'Subir logo',
    changeLogo: 'Cambiar logo',
    removeLogo: 'Quitar logo',
    save: 'Guardar',
    saving: 'Guardando…',
    saveSuccess: 'Marca actualizada',
    saveFailed: 'No se pudo guardar la marca',
    uploadFailed: 'Error al subir el logo: {message}',
    adminOnly: 'Solo administradores pueden editar la marca.',
    nameRequired: 'El nombre de la empresa es obligatorio',
    unsupportedImage: 'Tipo de imagen no admitido',
    imageTooLarge: 'La imagen es demasiado grande',
  },
  sections: {
    overview: 'Resumen',
    profile: 'Tu perfil',
    security: 'Inicio de sesión y seguridad',
    appearance: 'Apariencia',
    branding: 'Marca blanca',
    whatsapp: 'WhatsApp',
    templates: 'Plantillas',
    'quick-replies': 'Respuestas rápidas',
    fields: 'Campos y etiquetas',
    deals: 'Deals y moneda',
    members: 'Miembros del equipo',
    api: 'Claves API',
  },
  groups: {
    account: 'Cuenta',
    workspace: 'Espacio de trabajo',
  },
  members: {
    title: 'Miembros del equipo',
    description:
      'Personas con acceso a esta cuenta. Los roles controlan lo que puede hacer cada compañero.',
    inviteMember: 'Invitar miembro',
    online: 'en línea',
    away: 'ausente',
    offline: 'desconectado',
    memberCount:
      '{count} {count, plural, =1 {miembro} other {miembros}}',
    you: 'Tú',
    unnamed: 'Sin nombre',
    joined: 'Se unió el {date}',
    remove: 'Quitar',
    removedToast: 'Se quitó a {name}',
    updatedToast: 'Se actualizó a {name} como {role}',
    pendingInvitations: 'Invitaciones pendientes',
    inviteHint:
      'La URL de invitación en texto plano solo se muestra una vez al crearla por seguridad: para volver a compartirla, revoca la invitación y crea una nueva.',
    noPendingTitle: 'No hay invitaciones pendientes.',
    noPendingDesc:
      'Haz clic en <bold>Invitar miembro</bold> arriba para generar un enlace compartible.',
    untitledInvite: 'Invitación sin título',
    created: 'Creada {date}',
    expiresInDays:
      'expira en {days} {days, plural, =1 {día} other {días}}',
    expiresInHours:
      'expira en {hours} {hours, plural, =1 {hora} other {horas}}',
  },
  apiKeys: {
    title: 'Claves API',
    description:
      'Las claves autentican la API REST pública (<apiCode>/api/v1</apiCode>) para que puedas crear tus propias automatizaciones. Envíalas como <headerCode>Authorization: Bearer &lt;key&gt;</headerCode>.',
    newApiKey: 'Nueva clave API',
    noApiKeys: 'Aún no hay claves API.',
    createOneHint:
      'Haz clic en <bold>Nueva clave API</bold> para crear una.',
    askAdminHint: 'Pide a un administrador que cree una.',
    revoked: 'Revocada',
    expired: 'Expirada',
    noScopes: 'Sin permisos',
    created: 'Creada {date}',
    lastUsed: 'último uso {date}',
    neverUsed: 'nunca usada',
  },
  whatsapp: {
    title: 'WhatsApp',
    description:
      'Conecta Meta Cloud API o WAHA para enviar y recibir mensajes en la bandeja.',
    connected: 'Conectado',
    disconnected: 'Desconectado',
    save: 'Guardar',
    saving: 'Guardando…',
  },
  templates: {
    title: 'Plantillas',
    description:
      'Plantillas de mensajes de WhatsApp para iniciar conversaciones fuera de la ventana de 24 horas.',
  },
  roles: {
    owner: 'Propietario',
    admin: 'Admin',
    agent: 'Agente',
    viewer: 'Visor',
  },
};

es.Settings = merge(
  deepTranslate(JSON.parse(JSON.stringify(en.Settings))),
  settingsEs,
);

// Full deep-translate of major namespaces, then overlay curated Spanish
for (const ns of [
  'Contacts',
  'Pipelines',
  'Broadcasts',
  'Automations',
  'Dashboard',
  'Inbox',
  'Flows',
  'Agents',
  'Notifications',
]) {
  if (en[ns]) {
    es[ns] = merge(
      deepTranslate(JSON.parse(JSON.stringify(en[ns]))),
      es[ns] || {},
    );
  }
}

merge(es, {
  Dashboard: {
    page: {
      title: 'Panel',
      description:
        'Analítica en vivo de conversaciones, contactos, deals, difusiones y automatizaciones.',
      activeConversations: 'Conversaciones activas',
      newContactsToday: 'Contactos nuevos hoy',
      openDealsValue: 'Valor de deals abiertos',
      messagesSentToday: 'Mensajes enviados hoy',
    },
    quickActions: {
      newContact: 'Nuevo contacto',
      newDeal: 'Nuevo deal',
      newBroadcast: 'Nueva difusión',
      newAutomation: 'Nueva automatización',
    },
    activityFeed: {
      title: 'Actividad reciente',
      viewAll: 'Ver todo →',
      noActivity: 'Aún no hay actividad',
    },
  },
  Contacts: {
    page: {
      title: 'Contactos',
      searchPlaceholder: 'Buscar contactos…',
      newContact: 'Nuevo contacto',
      noContacts: 'No hay contactos',
    },
  },
  Inbox: {
    conversationList: {
      searchPlaceholder: 'Buscar conversaciones…',
      filterAll: 'Todas',
      filterUnread: 'No leídas',
      filterOpen: 'Abiertas',
      filterPending: 'Pendientes',
      filterClosed: 'Cerradas',
      noConversations: 'No se encontraron conversaciones',
      noMessagesYet: 'Sin mensajes aún',
      unknown: 'Desconocido',
    },
    messageThread: {
      statusOpen: 'Abierta',
      statusPending: 'Pendiente',
      statusClosed: 'Cerrada',
      assign: 'Asignar',
      selectConversation: 'Selecciona una conversación',
      today: 'Hoy',
      yesterday: 'Ayer',
    },
    composer: {
      typeMessage: 'Escribe un mensaje…',
      send: 'Enviar',
    },
    sidebar: {
      contactInfo: 'Info del contacto',
      tags: 'Etiquetas',
      notes: 'Notas',
      deals: 'Deals',
      noTags: 'Sin etiquetas',
      noDeals: 'Sin deals',
      addNotePlaceholder: 'Agregar una nota…',
      editName: 'Editar nombre',
      saveName: 'Guardar nombre',
      cancelEditName: 'Cancelar',
      namePlaceholder: 'Nombre del contacto',
      toastNameUpdated: 'Nombre actualizado',
      toastNameUpdateFailed: 'No se pudo actualizar el nombre',
    },
  },
});

fs.writeFileSync(path + '/es.json', JSON.stringify(es, null, 2) + '\n');

function keys(o, p = '') {
  let out = [];
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o))
      out = out.concat(keys(v, p ? p + '.' + k : k));
  } else out.push(p);
  return out;
}
const miss = keys(en).filter((k) => !new Set(keys(es)).has(k));
console.log('missing keys', miss.length);
console.log('deals', es.Settings.deals.title);
console.log('fields', es.Settings.tagsAndFields.title);
console.log('profile', es.Settings.profile.title);
console.log('profile.displayName', es.Settings.profile.displayName);
