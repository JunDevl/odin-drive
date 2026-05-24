export class PromiseError<T> {
  public error: T;

  constructor(error: T) {
    this.error = error;
  }
}

export const handleError = async <T>(promise: Promise<T>) => {
  try {
    const res = await promise;

    return res;
  } catch (e: any) {
    return new PromiseError(e);
  }
}