export interface GHLContactData {
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  address1?: string;
  postalCode?: string;
  website?: string;
  source: string;
  tags: string[];
  emailSequence: {
    subject: string;
    preheader: string;
    body: string;
  }[];
}

interface GHLCustomField {
  id: string;
  field_value: string;
}

interface GHLFieldIds {
  email_1_subject: string;
  email_1_body: string;
  email_1_preheader: string;
  email_2_subject: string;
  email_2_body: string;
  email_2_preheader: string;
  email_3_subject: string;
  email_3_body: string;
  email_3_preheader: string;
  email_4_subject: string;
  email_4_body: string;
  email_4_preheader: string;
  email_5_subject: string;
  email_5_body: string;
  email_5_preheader: string;
}

export function buildGHLFieldIds(env: Record<string, string>): GHLFieldIds {
  return {
    email_1_subject: env.GHL_CUSTOM_FIELD_EMAIL_1_SUBJECT,
    email_1_body: env.GHL_CUSTOM_FIELD_EMAIL_1_BODY,
    email_1_preheader: env.GHL_CUSTOM_FIELD_EMAIL_1_PREHEADER,
    email_2_subject: env.GHL_CUSTOM_FIELD_EMAIL_2_SUBJECT,
    email_2_body: env.GHL_CUSTOM_FIELD_EMAIL_2_BODY,
    email_2_preheader: env.GHL_CUSTOM_FIELD_EMAIL_2_PREHEADER,
    email_3_subject: env.GHL_CUSTOM_FIELD_EMAIL_3_SUBJECT,
    email_3_body: env.GHL_CUSTOM_FIELD_EMAIL_3_BODY,
    email_3_preheader: env.GHL_CUSTOM_FIELD_EMAIL_3_PREHEADER,
    email_4_subject: env.GHL_CUSTOM_FIELD_EMAIL_4_SUBJECT,
    email_4_body: env.GHL_CUSTOM_FIELD_EMAIL_4_BODY,
    email_4_preheader: env.GHL_CUSTOM_FIELD_EMAIL_4_PREHEADER,
    email_5_subject: env.GHL_CUSTOM_FIELD_EMAIL_5_SUBJECT,
    email_5_body: env.GHL_CUSTOM_FIELD_EMAIL_5_BODY,
    email_5_preheader: env.GHL_CUSTOM_FIELD_EMAIL_5_PREHEADER,
  };
}

export async function createOrUpdateContact(
  data: GHLContactData,
  token: string,
  locationId: string,
  fieldIds: GHLFieldIds
): Promise<{ contactId: string }> {
  // Build custom fields array for all 5 emails (15 fields total)
  const customFields: GHLCustomField[] = [];

  for (let i = 0; i < 5; i++) {
    const email = data.emailSequence[i];
    if (!email) continue;

    const num = i + 1;
    const subjectKey = `email_${num}_subject` as keyof GHLFieldIds;
    const bodyKey = `email_${num}_body` as keyof GHLFieldIds;
    const preheaderKey = `email_${num}_preheader` as keyof GHLFieldIds;

    if (fieldIds[subjectKey]) {
      customFields.push({ id: fieldIds[subjectKey], field_value: email.subject });
    }
    if (fieldIds[bodyKey]) {
      customFields.push({ id: fieldIds[bodyKey], field_value: email.body });
    }
    if (fieldIds[preheaderKey]) {
      customFields.push({ id: fieldIds[preheaderKey], field_value: email.preheader });
    }
  }

  const payload = {
    email: data.email,
    firstName: data.firstName,
    lastName: data.lastName,
    name: data.name,
    address1: data.address1 || undefined,
    postalCode: data.postalCode || undefined,
    website: data.website || undefined,
    source: data.source,
    tags: data.tags,
    locationId,
    customFields,
  };

  const response = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Version: '2021-07-28',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GHL API error ${response.status}: ${errorBody}`);
  }

  const result = (await response.json()) as { contact?: { id?: string } };
  const contactId = result.contact?.id;

  if (!contactId) {
    throw new Error('GHL response missing contact ID');
  }

  return { contactId };
}
