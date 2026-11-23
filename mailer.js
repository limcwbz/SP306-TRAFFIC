'use strict';
// Gmail SMTP 로 일일 보고 메일 발송 (Outlook 대체). 비밀 값은 모두 환경변수(GitHub Secrets)에서만 읽는다.
//   SMTP_USER  : 발신 Gmail 주소        SMTP_PASS : Gmail "앱 비밀번호" (로그인 비밀번호 아님)
//   SMTP_HOST  : 기본 smtp.gmail.com     SMTP_PORT : 기본 465 (SSL)
//   MAIL_TO    : 수신자                  SP306_DRYRUN=1 이면 발송하지 않고 .eml 파일로만 저장
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

async function sendReport({ to, subject, text, html, attachPath, extraAttach, inline, outDir }) {
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  // 첨부: 엑셀(attachPath) + 추가 첨부(extraAttach, 예: 독립형 HTML 보고서) + 본문 그림(inline, cid)
  const attachments = [{ filename: path.basename(attachPath), path: attachPath }]
    .concat((extraAttach || []).map(f => ({ filename: path.basename(f), path: f, contentType: /\.html?$/i.test(f) ? 'text/html; charset=utf-8' : undefined })))
    .concat((inline || []).map(i => ({ filename: path.basename(i.path), path: i.path, cid: i.cid })));
  const message = { from: user ? `"SP-306 교통상황" <${user}>` : 'sp306@example.invalid', to, subject, text, html, attachments };

  if (process.env.SP306_DRYRUN) { // 발송 없이 메시지만 만들어 파일로 저장 (시험용)
    const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    const info = await t.sendMail(message);
    const f = path.join(outDir, 'dryrun_mail.eml');
    fs.writeFileSync(f, info.message);
    return `DRYRUN_SAVED ${f} attachments=${attachments.length}`;
  }
  if (!user || !pass) throw new Error('SMTP_USER / SMTP_PASS 가 설정되지 않았습니다 (저장소 Secrets 확인).');
  if (!to) throw new Error('MAIL_TO 가 설정되지 않았습니다 (저장소 Secrets 확인).');
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465, auth: { user, pass },
    connectionTimeout: 30000, greetingTimeout: 30000, socketTimeout: 60000,
  });
  const info = await transport.sendMail(message);
  return `SENT ${info.messageId} attachments=${attachments.length} accepted=${(info.accepted || []).length}`;
}

module.exports = { sendReport };
