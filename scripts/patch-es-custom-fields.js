const fs = require('fs');
const p = 'd:/PAGINAS WEB/wacrm/messages/es.json';
const es = JSON.parse(fs.readFileSync(p, 'utf8'));
const en = JSON.parse(
  fs.readFileSync('d:/PAGINAS WEB/wacrm/messages/en.json', 'utf8'),
);

es.Contacts.customFields = {
  title: 'Campos personalizados',
  desc: 'Define campos extra del contacto (p. ej. código postal, origen del lead). Aparecen en cada contacto y en la acción de automatización “Actualizar campo de contacto”.',
  addField: 'Agregar',
  fieldName: 'Nombre del campo nuevo…',
  loading: 'Cargando…',
  empty: 'Aún no hay campos personalizados.',
  renameAria: 'Renombrar {name}',
  deleteTitle: 'Eliminar campo',
  deleteConfirm:
    '¿Eliminar "{name}"? También se borrará su valor guardado en cada contacto. No se puede deshacer.',
  toastNoAccount: 'Tu perfil no está vinculado a una cuenta.',
  toastDuplicate: 'Ya existe un campo llamado "{name}".',
  toastCreateFailed:
    'No se pudo crear el campo. Puede que no tengas permiso.',
  toastCreated: 'Se creó "{name}".',
  toastRenameFailed: 'No se pudo renombrar el campo.',
  toastDeleteFailed: 'No se pudo eliminar el campo.',
  toastDeleted: 'Se eliminó "{name}".',
};

if (es.Pipelines?.page) {
  Object.assign(es.Pipelines.page, {
    selectPipeline: 'Seleccionar embudo',
    noPipelinesYet: 'Aún no hay embudos',
    managePipelines: 'Gestionar embudos',
    addPipeline: 'Agregar embudo',
    addDeal: 'Agregar deal',
    createToStartTracking: 'Crea un embudo para empezar a seguir deals',
    createPipeline: 'Crear embudo',
    newPipeline: 'Nuevo embudo',
    pipelineName: 'Nombre del embudo',
    pipelineNamePlaceholder: 'p. ej. Ventas empresariales',
  });
}

fs.writeFileSync(p, JSON.stringify(es, null, 2) + '\n');

function keys(o, prefix = '') {
  let out = [];
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o)) {
      out = out.concat(keys(v, prefix ? prefix + '.' + k : k));
    }
  } else out.push(prefix);
  return out;
}
const miss = keys(en).filter((k) => !new Set(keys(es)).has(k));
console.log('miss', miss.length);
console.log(es.Contacts.customFields.addField, es.Contacts.customFields.empty);
