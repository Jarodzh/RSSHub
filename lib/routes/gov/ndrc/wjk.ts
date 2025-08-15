import { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

export const route: Route = {
    path: '/ndrc/wjk/:year?/:type?',
    name: '文件库',
    example: '/gov/ndrc/wjk',
    parameters: { 
        year: '年份，见下表，默认为全部', 
        type: '文件类型，见下表，默认为全部' 
    },
    maintainers: ['Jarodzh'],
    categories: ['government'],
    handler,
    description: `:::details 年份选项

| 2025 | 2024 | 2023 | 2022 | 2021 | 2020 | 2019 | 2018 | 2017以前 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | -------- |
| 2025 | 2024 | 2023 | 2022 | 2021 | 2020 | 2019 | 2018 | 2017ago  |

:::

:::details 文件类型选项

| 发展改革委令 | 规范性文件 | 公告 | 规划文本 | 通知 | 政策解读 | 其他 |
| ------------ | ---------- | ---- | -------- | ---- | -------- | ---- |
| fzggwl       | gfxwj      | gg   | ghwb     | tz   | zcjd     | qt   |

:::`,
    radar: [
        {
            title: '文件库',
            source: ['ndrc.gov.cn/xxgk/wjk/', 'ndrc.gov.cn/xxgk/wjk/index.html'],
            target: '/gov/ndrc/wjk',
        },
        {
            title: '文件库 - 按年份筛选',
            source: ['ndrc.gov.cn/xxgk/wjk/?year=:year'],
            target: (params) => `/gov/ndrc/wjk/${params.year}`,
        },
        {
            title: '文件库 - 按类型筛选',
            source: ['ndrc.gov.cn/xxgk/wjk/?type=:type'],
            target: (params) => `/gov/ndrc/wjk//${params.type}`,
        },
        {
            title: '文件库 - 按年份和类型筛选',
            source: ['ndrc.gov.cn/xxgk/wjk/?year=:year&type=:type'],
            target: (params) => `/gov/ndrc/wjk/${params.year}/${params.type}`,
        },
    ],
};

async function handler(ctx) {
    const year = ctx.req.param('year');
    const type = ctx.req.param('type');
    const limit = ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit'), 10) : 20;

    // 文件类型映射
    const typeMapping = {
        '发展改革委令': 'fzggwl',
        '规范性文件': 'gfxwj',
        '公告': 'gg',
        '规划文本': 'ghwb',
        '通知': 'tz',
        '政策解读': 'zcjd',
        '其他': 'qt',
    };

    // 构建查询参数
    let tab = '';
    let startDateStr = '';
    let endDateStr = '';
    let timeOption = 0;

    // 处理文件类型
    if (type) {
        tab = typeMapping[type] || type;
    }

    // 处理年份
    if (year && year !== 'all') {
        if (year.includes('ago')) {
            startDateStr = '1990-01-01';
            endDateStr = year.replace('ago', '') + '-12-31';
        } else {
            startDateStr = year + '-01-01';
            endDateStr = year + '-12-31';
        }
        timeOption = 2;
    }

    const apiUrl = 'https://fwfx.ndrc.gov.cn/api/query';
    
    const params = {
        qt: '', // 查询关键字，默认为空
        tab, // 文件类型
        page: 1, // 页数
        pageSize: limit, // 每页条数
        siteCode: 'bm04000fgk', // 站点代码
        key: 'CAB549A94CF659904A7D6B0E8FC8A7E9', // API 密钥
        startDateStr, // 开始日期
        endDateStr, // 结束日期
        timeOption, // 时间选项：0-不限，2-按时间范围
        sort: 'dateDesc', // 排序方式：按日期降序
    };

    // 调用 API
    const { data: response } = await got(apiUrl, {
        searchParams: params,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Referer': 'https://www.ndrc.gov.cn/',
        },
    });

    if (!response.ok || !response.data.resultList) {
        throw new Error('API 返回数据格式错误');
    }

    const items = await Promise.all(
        response.data.resultList.map((item) =>
            cache.tryGet(item.url, async () => {
                // 获取文章详细内容
                let description = item.summary || '';
                let content = '';

                try {
                    const { data: detailResponse } = await got(item.url);
                    const cheerio = await import('cheerio');
                    const $ = cheerio.load(detailResponse);
                    
                    // 尝试获取更详细的内容
                    const contentSelectors = ['.TRS_Editor', '.article_con', '.content', '.main-content', 'div[class*="content"]'];
                    for (const selector of contentSelectors) {
                        const contentElement = $(selector);
                        if (contentElement.length && contentElement.html()) {
                            content = contentElement.html();
                            break;
                        }
                    }
                    
                    if (content) {
                        description = content;
                    }
                } catch {
                    // 如果获取详细内容失败，使用 summary
                    description = item.summary || item.title;
                }

                return {
                    title: item.title,
                    link: item.url,
                    description,
                    pubDate: timezone(parseDate(item.docDate), +8),
                    author: item.domainSiteName || '国家发展和改革委员会',
                    category: [item.myValues?.C8 || type || '文件库'].filter(Boolean),
                };
            })
        )
    );

    const currentUrl = `https://www.ndrc.gov.cn/xxgk/wjk/${year ? `?year=${year}` : ''}${type ? `${year ? '&' : '?'}type=${encodeURIComponent(type)}` : ''}`;

    return {
        title: `文件库-国家发展和改革委员会${year ? ` - ${year}年` : ''}${type ? ` - ${type}` : ''}`,
        link: currentUrl,
        description: '为您提供政策文件、解读信息的查询功能 - Powered by RSSHub',
        item: items,
        language: 'zh-cn',
        image: 'https://www.ndrc.gov.cn/images/logo.png',
        author: '国家发展和改革委员会',
    };
}
