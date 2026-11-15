/**
 * Nova Poshta: method → settlement (real suggestions with the oblast) → pickup
 * point of that method in that settlement. Only a picked item counts: typing
 * after a pick clears its Ref; changing the city or the method clears the point.
 */
import {Banner} from '@astryxdesign/core/Banner';
import {VStack} from '@astryxdesign/core/Layout';
import {RadioList, RadioListItem} from '@astryxdesign/core/RadioList';
import {Text} from '@astryxdesign/core/Text';
import {Typeahead, type SearchSource} from '@astryxdesign/core/Typeahead';
import {useMemo, useRef, useState} from 'react';
import {DELIVERY_METHODS, type DeliveryMethod, type NpSettlement, type NpWarehouse} from '../../supabase/functions/_shared/contracts.ts';
import {ApiError, npSettlements, npWarehouses} from '../lib/api.ts';

export type NpValue = {method: DeliveryMethod | null; settlement: NpSettlement | null; warehouse: NpWarehouse | null};
type SItem = {id: string; label: string; auxiliaryData: NpSettlement};
type WItem = {id: string; label: string; auxiliaryData: NpWarehouse};

const cache = new Map<string, unknown>();

/** A search source that debounces in the component, aborts stale requests and caches answers. */
function source<T>(key: string, load: (q: string, signal: AbortSignal) => Promise<T[]>, onError: (e: unknown) => void, bootstrap = false): SearchSource<T & {id: string; label: string}> {
  let ctrl: AbortController | null = null;
  const run = async (q: string) => {
    const k = `${key}|${q.trim().toLowerCase()}`;
    if (cache.has(k)) return cache.get(k) as (T & {id: string; label: string})[];
    ctrl?.abort();
    ctrl = new AbortController();
    try {
      const items = await load(q, ctrl.signal);
      cache.set(k, items);
      onError(null);
      return items as (T & {id: string; label: string})[];
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return [];
      onError(e);
      return []; // never invent points when the API is down
    }
  };
  return {
    search: run,
    bootstrap: () => (bootstrap ? run('') : []),
    cancel: () => ctrl?.abort(),
  };
}

export function NpPicker({value, onChange, errors}: {value: NpValue; onChange: (v: NpValue) => void; errors: {method?: string; settlement?: string; warehouse?: string}}) {
  const [apiError, setApiError] = useState<string | null>(null);
  const onErr = (e: unknown) => setApiError(e ? (e instanceof ApiError ? e.message : 'Сервіс Нової пошти зараз недоступний.') : null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const settlements = useMemo(
    () =>
      source<SItem>(
        'np-s',
        async (q, signal) => (q.trim().length < 2 ? [] : (await npSettlements(q, signal)).items.map(s => ({id: s.settlement_ref, label: s.label, auxiliaryData: s}))),
        onErr,
      ),
    [],
  );
  const cityRef = value.settlement?.city_ref ?? null;
  const warehouses = useMemo(
    () =>
      cityRef && value.method
        ? source<WItem>(
            `np-w|${cityRef}|${value.method}`,
            async (q, signal) => (await npWarehouses(cityRef, value.method!, q, signal)).items.map(w => ({id: w.ref, label: w.name, auxiliaryData: w})),
            onErr,
            true,
          )
        : null,
    [cityRef, value.method],
  );

  const pointLabel = value.method === 'np_postomat' ? 'Поштомат' : 'Відділення';
  const sValue: SItem | null = value.settlement ? {id: value.settlement.settlement_ref, label: value.settlement.label, auxiliaryData: value.settlement} : null;
  const wValue: WItem | null = value.warehouse ? {id: value.warehouse.ref, label: value.warehouse.name, auxiliaryData: value.warehouse} : null;

  return (
    <VStack gap={4}>
      <RadioList
        label="Спосіб доставки"
        value={value.method ?? ''}
        onChange={m => onChange({method: m as DeliveryMethod, settlement: value.settlement, warehouse: null})}
        status={errors.method ? {type: 'error', message: errors.method} : undefined}
        isRequired
      >
        {DELIVERY_METHODS.map(m => (
          <RadioListItem key={m.key} value={m.key} label={m.label} />
        ))}
      </RadioList>
      <Typeahead<SItem>
        label="Населений пункт"
        description="Почніть вводити назву й оберіть зі списку (з областю)"
        searchSource={settlements}
        value={sValue}
        onChange={item => onChange({method: valueRef.current.method, settlement: item?.auxiliaryData ?? null, warehouse: null})}
        onChangeQuery={q => {
          // editing the text of a picked city drops its Ref
          if (valueRef.current.settlement && q !== valueRef.current.settlement.label) onChange({...valueRef.current, settlement: null, warehouse: null});
        }}
        minQueryLength={2}
        debounceMs={300}
        maxMenuItems={20}
        emptySearchText="Населений пункт не знайдено"
        status={errors.settlement ? {type: 'error', message: errors.settlement} : undefined}
        isRequired
        hasClear
      />
      <Typeahead<WItem>
        key={`${cityRef}|${value.method}`}
        label={pointLabel}
        description={value.settlement ? 'Введіть номер або частину адреси й оберіть зі списку' : 'Спершу оберіть населений пункт'}
        searchSource={warehouses ?? {search: () => [], bootstrap: () => []}}
        value={wValue}
        onChange={item => onChange({...valueRef.current, warehouse: item?.auxiliaryData ?? null})}
        onChangeQuery={q => {
          if (valueRef.current.warehouse && q !== valueRef.current.warehouse.name) onChange({...valueRef.current, warehouse: null});
        }}
        isDisabled={!warehouses}
        disabledMessage="Спершу оберіть спосіб доставки й населений пункт"
        hasEntriesOnFocus
        debounceMs={300}
        maxMenuItems={30}
        emptySearchText={`${pointLabel} не знайдено. Спробуйте номер або назву вулиці.`}
        status={errors.warehouse ? {type: 'error', message: errors.warehouse} : undefined}
        isRequired
        hasClear
      />
      {apiError && <Banner status="error" title={apiError} description="Без сервісу Нової пошти оформити доставку не вийде. Спробуйте трохи пізніше." collapsible={false} />}
      <Text type="supporting" color="secondary">
        Доставку сплачує отримувач за тарифами Нової пошти при отриманні. Її вартість не входить в оплату товарів.
      </Text>
    </VStack>
  );
}
