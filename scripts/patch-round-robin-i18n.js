const fs = require('fs');

function patch(file, locale) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const isEs = locale === 'es';
  const isKo = locale === 'ko';

  Object.assign(data.Settings.members, {
    roundRobinTitle: isEs
      ? 'Asignación round-robin'
      : isKo
        ? '라운드로빈 배정'
        : 'Round-robin assignment',
    roundRobinDesc: isEs
      ? 'Los chats nuevos entrantes se asignan por turnos entre agentes y admins. También puedes usar el paso “Asignar conversación → Round-robin” en Automatizaciones.'
      : isKo
        ? '새 인바운드 채팅을 상담원/관리자에게 순서대로 배정합니다. 자동화의 “대화 배정 → 라운드로빈” 단계도 사용할 수 있습니다.'
        : 'New inbound chats rotate across agents and admins. You can also use the Automations step “Assign conversation → Round-robin”.',
    roundRobinToggle: isEs
      ? 'Activar round-robin en chats nuevos'
      : isKo
        ? '새 채팅 라운드로빈 켜기'
        : 'Enable round-robin on new chats',
    roundRobinSaving: isEs ? 'Guardando…' : isKo ? '저장 중…' : 'Saving…',
    roundRobinEnabled: isEs
      ? 'Round-robin activado'
      : isKo
        ? '라운드로빈이 켜졌습니다'
        : 'Round-robin enabled',
    roundRobinDisabled: isEs
      ? 'Round-robin desactivado'
      : isKo
        ? '라운드로빈이 꺼졌습니다'
        : 'Round-robin disabled',
    roundRobinSaveFailed: isEs
      ? 'No se pudo guardar round-robin'
      : isKo
        ? '라운드로빈 설정을 저장하지 못했습니다'
        : 'Couldn’t save round-robin setting',
  });

  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log('patched', locale);
}

patch('d:/PAGINAS WEB/wacrm/messages/en.json', 'en');
patch('d:/PAGINAS WEB/wacrm/messages/es.json', 'es');
patch('d:/PAGINAS WEB/wacrm/messages/ko.json', 'ko');
