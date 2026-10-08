# quotes.md의 <details> 항목을 quotes_per_page(기본 20)개씩 나눠 /quotes/, /quotes/page/2/ ...로 만든다.
# quotes.md에는 지금처럼 항목을 맨 위에 계속 추가하면 되고, 쪽 수와 경계는 빌드할 때마다 다시 계산한다.
module QuotesPagination
  class Generator < Jekyll::Generator
    safe true
    priority :low

    ENTRY = %r{<details markdown="1">.*?</details>}m

    def generate(site)
      index = site.pages.find { |p| p.path == "quotes.md" }
      return unless index

      per = (site.config["quotes_per_page"] || 20).to_i
      head = index.content[/\A.*?(?=<details)/m].to_s
      entries = index.content.scan(ENTRY)
      pages = entries.each_slice(per).to_a
      total = pages.size
      return if total <= 1

      index.content = head + pages[0].join("\n\n") + "\n\n" + pager(1, total)
      index.data["nav"] = "/quotes/"

      pages.each_with_index do |chunk, i|
        next if i.zero?
        n = i + 1
        page = Jekyll::PageWithoutAFile.new(site, site.source, "quotes/page/#{n}", "index.md")
        page.content = head + chunk.join("\n\n") + "\n\n" + pager(n, total)
        page.data.merge!(
          "layout" => "page",
          "title" => index.data["title"],
          "subtitle" => index.data["subtitle"],
          "permalink" => "/quotes/page/#{n}/",
          "nav" => "/quotes/"
        )
        site.pages << page
      end
    end

    private

    def pager(current, total)
      link = ->(n) { n == 1 ? "/quotes/" : "/quotes/page/#{n}/" }
      items = (1..total).map do |n|
        if n == current
          %(<span aria-current="page">#{n}</span>)
        else
          %(<a href="{{ '#{link.(n)}' | relative_url }}">#{n}</a>)
        end
      end
      prev_link = current > 1 ? %(<a href="{{ '#{link.(current - 1)}' | relative_url }}" rel="prev">←</a>) : ""
      next_link = current < total ? %(<a href="{{ '#{link.(current + 1)}' | relative_url }}" rel="next">→</a>) : ""
      %(<nav class="pager mono" aria-label="quotes pages">#{prev_link}#{items.join}#{next_link}</nav>\n)
    end
  end
end
