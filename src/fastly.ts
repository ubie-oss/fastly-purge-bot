
import fetch from "node-fetch";
import LinkHeader from "http-link-header";
import Url from 'url-parse';

type PurgeUrlResponse = { status: string, id: string };
type PurgeAllResponse = { status: string };
type PurgeResponse = { [key: string]: string };

export type Service = {
  id: string;
  name: string;
};

type ListServicesParameters = {
  page: number;
  perPage?: number;
  direction?: string;
  sort?: string;
};

// https://developer.fastly.com/reference/api/purging/
export class FastlyClient {
  private apiToken: string;
  private endpoint: string;

  constructor(apiToken: string) {
    this.apiToken = apiToken;
    this.endpoint = "https://api.fastly.com";
  }

  private defaultHeaders(): { [key: string]: string } {
    return {
      "Accept": 'application/json',
      "Fastly-Key": this.apiToken,
    }
  }

  async getService(serviceId: string): Promise<Service> {
    const url = new URL(`/service/${serviceId}`, this.endpoint);
    const resp = await fetch(url.toString(), {
      headers: this.defaultHeaders(),
    });

    if (!resp.ok) {
      throw Error(`failed to get service: ${url}`);
    }

    return await resp.json() as Service;
  }

  async ListServices(): Promise<Array<Service>> {
    let page = 1;
    let allServices: Array<Service> = [];

    while (true) {
      const [services, nextPage] = await this.listServicesWithNextPage({ page, perPage: 20, sort: 'name' });
      allServices = allServices.concat(services);

      if (nextPage === undefined) {
        break;
      }
      page = nextPage;
    }

    return allServices;
  }

  private async listServicesWithNextPage(params: ListServicesParameters): Promise<[Array<Service>, number?]> {
    let url = new URL('/service', this.endpoint) + '?' + new URLSearchParams({
      page: params.page.toString(),
      direction: params.direction || 'ascend',
      per_page: params.perPage?.toString() || '20',
      sort: params.sort || 'created',
    });

    const resp = await fetch(url.toString(), {
      headers: this.defaultHeaders(),
    });

    if (!resp.ok) {
      throw Error(`failed to list services: ${url}. Status ${resp.status}`);
    }

    const linkHeader = resp.headers.get('link');
    if (linkHeader === null) {
      throw new Error(`failed to list services; link response header is not found!`);
    }
    const link = LinkHeader.parse(linkHeader);

    let nextPage: number | undefined;
    if (link.has('rel', 'next') && link.has('rel', 'last')) {
      const nextPageStr = new Url(link.get('rel', 'next')[0].uri, true).query.page!;
      const lastPageStr = new Url(link.get('rel', 'last')[0].uri, true).query.page!;
      nextPage = Number(lastPageStr) !== params.page ? Number(nextPageStr) : undefined;
    } else {
      nextPage = undefined;
    }

    const services = await resp.json() as Array<Service>;

    return [services, nextPage];
  }

  async PurgeUrl(url: string, soft: boolean): Promise<PurgeUrlResponse> {
    const resp = await fetch(url, {
      method: 'PURGE',
      headers: { ...this.defaultHeaders(), "fastly-soft-purge": soft ? "1" : "0" },
    });

    if (!resp.ok) {
      throw Error(`failed to purge url: ${url}. Status ${resp.status}`);
    }

    return await resp.json() as PurgeUrlResponse;
  }

  async PurgeAll(serviceId: string): Promise<PurgeAllResponse> {
    const url = new URL(`/service/${serviceId}/purge_all`, this.endpoint);
    const resp = await fetch(url.toString(), {
      method: 'POST',
      headers: this.defaultHeaders(),
    });

    if (!resp.ok) {
      throw Error(`failed to purge all: ${url}. Status ${resp.status}`);
    }

    return await resp.json() as PurgeAllResponse
  }

  async Purge(serviceId: string, surrogateKeys: string[], soft: boolean): Promise<PurgeResponse> {
    const url = new URL(`/service/${serviceId}/purge`, this.endpoint);
    const resp = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        ...this.defaultHeaders(), 
        "fastly-soft-purge": soft ? "1" : "0",
        "surrogate-key": surrogateKeys.join(" "),
      },
    });

    if (!resp.ok) {
      throw Error(`failed to purge: ${url}. Status ${resp.status}`);
    }

    return await resp.json() as PurgeResponse;
  }
}
