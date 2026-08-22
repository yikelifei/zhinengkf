export type ConversationWorkbenchContent = {
  type: "location" | "link" | "business_card" | "miniprogram" | "msgmenu" | "product" | string;
  title?: string;
  description?: string;
  url?: string;
  imageUrl?: string;
  name?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  userId?: string;
  appId?: string;
  pagePath?: string;
  price?: string;
  skuCode?: string;
  headContent?: string;
  tailContent?: string;
  items?: Array<{
    type?: string;
    label?: string;
    url?: string;
    id?: string;
    appId?: string;
    pagePath?: string;
  }>;
};
