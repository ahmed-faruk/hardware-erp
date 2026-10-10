import { renderToStaticMarkup } from 'react-dom/server';

import type { ShiftReportData } from '@/db/shift-report';
import type { PurchaseDocumentData } from '@/db/purchase-document';
import type { CollectionSlipData, NoSaleSlipData } from '@/db/commands/receipts';
import type { DigitStyle } from '@/domain/digits';
import type { ReceiptData } from '@/domain/receipt';

import { CollectionSlip } from './CollectionSlip';
import { MoneySlip, ShiftSlip } from './ShiftSlip';
import { PurchaseDocument } from './PurchaseDocument';
import { a4Css, StatementDocument } from './StatementDocument';
import { NoSaleSlip } from './NoSaleSlip';
import { Receipt } from './Receipt';
import { receiptCss, type Paper } from './receipt-css';

const page = (body: string, paper: Paper, fontFaces: string): string =>
  `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title></title><style>${receiptCss(paper, fontFaces)}</style></head><body>${body}</body></html>`;

export const renderReceiptHtml = (data: ReceiptData, paper: Paper, fontFaces = ''): string =>
  page(renderToStaticMarkup(<Receipt data={data} />), paper, fontFaces);

export const renderNoSaleHtml = (
  shopName: string,
  slip: NoSaleSlipData,
  dateText: string,
  paper: Paper,
  fontFaces = '',
): string =>
  page(
    renderToStaticMarkup(<NoSaleSlip shopName={shopName} slip={slip} dateText={dateText} />),
    paper,
    fontFaces,
  );

export const renderCollectionHtml = (
  slip: CollectionSlipData,
  digits: DigitStyle,
  paper: Paper,
  fontFaces = '',
): string => page(renderToStaticMarkup(<CollectionSlip slip={slip} digits={digits} />), paper, fontFaces);

export const renderStatementHtml = (props: Parameters<typeof StatementDocument>[0], fontFaces = ''): string =>
  `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title></title><style>${a4Css(fontFaces)}</style></head><body>${renderToStaticMarkup(<StatementDocument {...props} />)}</body></html>`;

export const renderPurchaseHtml = (doc: PurchaseDocumentData, fontFaces = ''): string =>
  `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title></title><style>${a4Css(fontFaces)}</style></head><body>${renderToStaticMarkup(<PurchaseDocument doc={doc} />)}</body></html>`;

export const renderShiftHtml = (
  data: ShiftReportData,
  digits: DigitStyle,
  paper: Paper,
  fontFaces = '',
): string => page(renderToStaticMarkup(<ShiftSlip data={data} digits={digits} />), paper, fontFaces);

export const renderMoneySlipHtml = (
  props: Parameters<typeof MoneySlip>[0],
  paper: Paper,
  fontFaces = '',
): string => page(renderToStaticMarkup(<MoneySlip {...props} />), paper, fontFaces);
