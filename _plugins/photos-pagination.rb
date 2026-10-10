# _data/photos.yml의 사진을 photos_per_page(기본 30)장씩 나눠 /photos/, /photos/page/2/ ...로 만든다.
# 마지막 쪽에 photos_orphan_max(기본 3)장 이하만 남으면 앞 쪽에 합쳐 한 줄짜리 쪽이 생기지 않게 한다.
# 사진은 지금처럼 _data/photos.yml 맨 위에 계속 추가하면 되고, 쪽 수와 경계는 빌드할 때마다 다시 계산한다.
module PhotosPagination
  class Generator < Jekyll::Generator
    safe true
    priority :low

    def generate(site)
      index = site.pages.find { |p| p.path == "photos.md" }
      return unless index

      photos = site.data["photos"] || []
      per = (site.config["photos_per_page"] || 30).to_i
      orphan = (site.config["photos_orphan_max"] || 3).to_i
      pages = split(photos, per, orphan)
      total = pages.size
      return if total <= 1

      raw = index.content
      index.data["photos"] = pages[0]
      index.data["pager"] = pager(site, 1, total)
      index.data["nav"] = "/photos/"

      pages.each_with_index do |chunk, i|
        next if i.zero?
        n = i + 1
        page = Jekyll::PageWithoutAFile.new(site, site.source, "photos/page/#{n}", "index.md")
        page.content = raw
        page.data.merge!(
          "layout" => "page",
          "title" => index.data["title"],
          "subtitle" => index.data["subtitle"],
          "permalink" => "/photos/page/#{n}/",
          "nav" => "/photos/",
          "photos" => chunk,
          "pager" => pager(site, n, total)
        )
        site.pages << page
      end
    end

    private

    def split(photos, per, orphan)
      chunks = photos.each_slice(per).to_a
      if chunks.size > 1 && chunks.last.size <= orphan
        tail = chunks.pop
        chunks.last.concat(tail)
      end
      chunks
    end

    def pager(site, current, total)
      base = site.config["baseurl"].to_s.chomp("/")
      link = ->(n) { base + (n == 1 ? "/photos/" : "/photos/page/#{n}/") }
      items = (1..total).map do |n|
        if n == current
          %(<span aria-current="page">#{n}</span>)
        else
          %(<a href="#{link.(n)}">#{n}</a>)
        end
      end
      prev_link = current > 1 ? %(<a href="#{link.(current - 1)}" rel="prev">←</a>) : ""
      next_link = current < total ? %(<a href="#{link.(current + 1)}" rel="next">→</a>) : ""
      %(<nav class="pager mono" aria-label="photos pages">#{prev_link}#{items.join}#{next_link}</nav>)
    end
  end
end
