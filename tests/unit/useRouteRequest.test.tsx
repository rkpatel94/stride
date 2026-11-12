import { renderHook } from '@testing-library/react-native';
import { StrictMode } from 'react';

import { useRouteRequest } from '@/hooks/useRouteRequest';

type Props = { value: string | undefined };

async function setup(initial: string | undefined) {
  const onRequest = jest.fn();
  const hook = await renderHook(({ value }: Props) => useRouteRequest(value, onRequest), {
    initialProps: { value: initial },
  });
  return { onRequest, hook };
}

describe('useRouteRequest', () => {
  it('handles a request once while its param stays in the route', async () => {
    const { onRequest, hook } = await setup('walk');
    await hook.rerender({ value: 'walk' });
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledWith('walk');
  });

  it('handles a request once even when Strict Mode runs effects twice', async () => {
    const onRequest = jest.fn();
    await renderHook(() => useRouteRequest('walk', onRequest), { wrapper: StrictMode });
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it('handles the same request again once the param was cleared (the Track tab stays mounted)', async () => {
    const { onRequest, hook } = await setup('walk');
    await hook.rerender({ value: undefined }); // the screen cleared the param
    await hook.rerender({ value: 'walk' }); // the next "Start walk" from Home
    expect(onRequest).toHaveBeenCalledTimes(2);
  });

  it('handles a different request straight away', async () => {
    const { onRequest, hook } = await setup('walk');
    await hook.rerender({ value: 'run' });
    expect(onRequest).toHaveBeenNthCalledWith(2, 'run');
  });

  it('does nothing without a param', async () => {
    const { onRequest } = await setup(undefined);
    expect(onRequest).not.toHaveBeenCalled();
  });
});
