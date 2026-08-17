const fs = require('fs');

function patch(file, locale) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const isEs = locale === 'es';
  const isKo = locale === 'ko';

  Object.assign(data.Settings.members, {
    restrictTitle: isEs
      ? 'Limitar contactos de agentes'
      : isKo
        ? '상담원 연락처 제한'
        : 'Limit agent contacts',
    restrictDesc: isEs
      ? 'Si está activo, los agentes y visores solo ven contactos que crearon o que les asignaste (en la bandeja con Asignar). Los administradores y el propietario siguen viendo todo.'
      : isKo
        ? '켜면 상담원/뷰어는 직접 만든 연락처나 배정된 연락처만 봅니다. 관리자와 소유자는 전체를 봅니다.'
        : 'When on, agents and viewers only see contacts they created or that you assigned to them (Inbox → Assign). Owners and admins still see everything.',
    restrictToggle: isEs
      ? 'Solo contactos propios / asignados'
      : isKo
        ? '본인/배정 연락처만'
        : 'Only owned / assigned contacts',
    restrictSaving: isEs ? 'Guardando…' : isKo ? '저장 중…' : 'Saving…',
    restrictEnabled: isEs
      ? 'Restricción de agentes activada'
      : isKo
        ? '상담원 제한이 켜졌습니다'
        : 'Agent contact restriction enabled',
    restrictDisabled: isEs
      ? 'Restricción de agentes desactivada'
      : isKo
        ? '상담원 제한이 꺼졌습니다'
        : 'Agent contact restriction disabled',
    restrictSaveFailed: isEs
      ? 'No se pudo guardar la restricción'
      : isKo
        ? '제한 설정을 저장하지 못했습니다'
        : 'Couldn’t save restriction',
    title: isEs
      ? 'Miembros del equipo'
      : isKo
        ? data.Settings.members.title
        : 'Team members',
    description: isEs
      ? 'Personas con acceso a esta cuenta. Cambia el rol de cada agente y, si quieres, limita qué contactos pueden ver.'
      : isKo
        ? data.Settings.members.description
        : 'People with access to this account. Change each teammate’s role, and optionally limit which contacts agents can see.',
    pendingInvitations: isEs
      ? 'Invitaciones pendientes'
      : data.Settings.members.pendingInvitations,
    inviteMember: isEs ? 'Invitar miembro' : data.Settings.members.inviteMember,
    revoke: isEs ? 'Revocar' : isKo ? '취소' : 'Revoke',
    revokedToast: isEs
      ? 'Invitación revocada'
      : isKo
        ? '초대가 취소되었습니다'
        : 'Invitation revoked',
    removeDialogTitle: isEs
      ? 'Quitar miembro'
      : isKo
        ? '멤버 제거'
        : 'Remove member',
    removeDialogDesc: isEs
      ? '¿Quitar a <bold>{name}</bold> de la cuenta? Se cerrará su sesión en esta cuenta y obtendrá una cuenta personal en el próximo inicio de sesión. Su login no se elimina.'
      : data.Settings.members.removeDialogDesc,
    removing: isEs ? 'Quitando…' : isKo ? '제거 중…' : 'Removing...',
    removeBtn: isEs ? 'Quitar miembro' : isKo ? '멤버 제거' : 'Remove member',
    expired: isEs ? 'expirada' : isKo ? '만료됨' : 'expired',
  });

  Object.assign(data.Settings.roles, {
    admin: isEs ? 'Admin' : data.Settings.roles.admin,
    adminHint: isEs
      ? 'Gestiona miembros y toda la configuración'
      : isKo
        ? '멤버와 모든 설정 관리'
        : 'Manage members + everything',
    agent: isEs ? 'Agente' : data.Settings.roles.agent,
    agentHint: isEs
      ? 'Bandeja y contactos; sin configuración (si activas la restricción, solo ve lo suyo)'
      : isKo
        ? '기능 사용; 설정 없음 (제한 시 본인 연락처만)'
        : 'Use features; no settings (with restriction: only own/assigned contacts)',
    viewer: isEs ? 'Visor' : data.Settings.roles.viewer,
    viewerHint: isEs
      ? 'Solo lectura'
      : isKo
        ? '읽기 전용'
        : 'Read-only across the app',
    owner: isEs ? 'Propietario' : data.Settings.roles.owner,
    ownerHint: isEs
      ? 'Control total de la cuenta'
      : isKo
        ? '계정 전체 제어'
        : 'Full control over account and billing',
  });

  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log('patched', locale);
}

patch('d:/PAGINAS WEB/wacrm/messages/en.json', 'en');
patch('d:/PAGINAS WEB/wacrm/messages/es.json', 'es');
patch('d:/PAGINAS WEB/wacrm/messages/ko.json', 'ko');
